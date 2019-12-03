import * as firebase from 'firebase/app';
import 'firebase/database';
import 'firebase/storage';
import 'firebase/app';

import Methods from './methods';
import {
  AllParams,
  GetOneParams,
  DeleteParams,
  CreateParams,
  DeleteManyParams,
} from './params';
import {
  GET_LIST,
  GET_ONE,
  GET_MANY,
  GET_MANY_REFERENCE,
  CREATE,
  UPDATE,
  UPDATE_MANY,
  DELETE,
  DELETE_MANY,
  EXECUTE,
} from './reference';
import { defaultsDeep } from 'lodash';
import { DiffPatcher } from 'jsondiffpatch';
import * as debug from 'debug';
const log = debug('ra-data-firestore');

/**
 * @param {string[]|Object[]} trackedResources Array of resource names or array of Objects containing name and
 * optional path properties (path defaults to name)
 * @param {Object} firebaseConfig Options Firebase configuration
 */

export interface ResourceConfig {
  audit: boolean;
  name: string;
  path: string;
  isPublic?: boolean;
  uploadFields: string[];
}

export type SystemFieldsConfigs = {
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type DataConfig = {
  debug: boolean;
  initialQueryTimeout: number;
  timestampFieldNames: SystemFieldsConfigs;
  auditResource?: string;
  trackedResources: ResourceConfig[];
  firebaseSaveFilter: (data, name?) => any;
  firebaseGetFilter: (data, name?) => any;
  userActions?: CustomActionConfig;
} & typeof Methods;

const BaseConfiguration: Partial<DataConfig> = {
  initialQueryTimeout: 10000,
  timestampFieldNames: {
    createdAt: 'createdAt',
    createdBy: 'createdBy',
    updatedAt: 'updatedAt',
    updatedBy: 'updatedBy',
  },
  auditResource: 'backup',
  userActions: {},
};

export type CustomActionConfig = {
  [name: string]: (params, context) => Promise<any>;
};

export type ResourceStore = {
  [key: string]: { [field: string]: any; id: string; key: string };
};

export type ResourceDataStore = {
  [resource: string]: ResourceStore;
};

export type ExecutionContext = {
  patcher: DiffPatcher;
  dataProvider: (
    type: string,
    resourceName: string,
    params: AllParams,
  ) => Promise<any>;
  resourcesData: ResourceDataStore;
  resourcesPaths: { [resource: string]: string };
  resourcesStatus: Promise<any>;
  userActions: CustomActionConfig;
  auditResource: string;
  timestampFieldNames: SystemFieldsConfigs;
};

function dataConfig(firebaseConfig = {}, options: Partial<DataConfig> = {}) {
  options = defaultsDeep(options, BaseConfiguration);
  const {
    debug,
    timestampFieldNames,
    trackedResources,
    initialQueryTimeout,
    auditResource,
    userActions,
  } = options;
  if (debug && localStorage) {
    localStorage.debug = 'ra-data-firestore';
  }
  const trackedResourcesIndex = {};
  const noDiff = [timestampFieldNames.updatedAt, timestampFieldNames.createdAt];

  const patcher = new DiffPatcher({
    propertyFilter: function(name, context) {
      return noDiff.indexOf(name) === -1;
    },
  });

  const resourcesStatus = {};
  const resourcesReferences = {};
  const resourcesData = {};
  const resourcesPaths = {};
  const resourcesUploadFields = {};

  if (firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION);
  }

  /* Functions */
  const upload = options.upload || Methods.upload;
  const save = options.save || Methods.save;
  const del = options.del || Methods.del;
  const getItemID = options.getItemID || Methods.getItemID;
  const getOne = options.getOne || Methods.getOne;
  const getMany = options.getMany || Methods.getMany;

  const firebaseSaveFilter = options.firebaseSaveFilter
    ? options.firebaseSaveFilter
    : data => data;
  const firebaseGetFilter = options.firebaseGetFilter
    ? options.firebaseGetFilter
    : data => data;

  // Sanitize Resources
  trackedResources.map((resource, index) => {
    if (typeof resource === 'string') {
      resource = {
        name: resource,
        path: resource,
        uploadFields: [],
        audit: true,
      };
      trackedResources[index] = resource;
    } else {
      defaultsDeep(resource, {
        name: resource.name || resource.path,
        path: resource.path || resource.name,
        uploadFields: [],
        audit: true,
      });
    }
    const { name, path, uploadFields } = resource;
    trackedResourcesIndex[name] = index;

    if (!resource.name) {
      throw new Error(`name is missing from resource ${resource}`);
    }
    resourcesUploadFields[name] = uploadFields || [];
    resourcesPaths[name] = path || name;
    resourcesData[name] = {};
  });

  const initializeResource = ({ name, isPublic }: ResourceConfig, resolve) => {
    let ref = (resourcesReferences[name] = firebase
      .database()
      .ref(resourcesPaths[name]));
    resourcesData[name] = [];
    if (isPublic) {
      subscribeResource(ref, name, resolve);
    } else {
      firebase.auth().onAuthStateChanged(auth => {
        if (auth) {
          subscribeResource(ref, name, resolve);
        }
      });
    }
    setTimeout(resolve, initialQueryTimeout);
  };

  const subscribeResource = (ref, name, resolve) => {
    ref.once('value', function(childSnapshot) {
      /** Uses "value" to fetch initial data. Avoid the AOR to show no results */
      if (childSnapshot.key === name) {
        const entries = childSnapshot.val() || {};
        Object.keys(entries).map(key => {
          resourcesData[name][key] = firebaseGetFilter(entries[key], name);
        });
        Object.keys(resourcesData[name]).forEach(itemKey => {
          resourcesData[name][itemKey].id = itemKey;
          resourcesData[name][itemKey].key = itemKey;
        });
        resolve();
      }
    });
    ref.on('child_added', function(childSnapshot) {
      resourcesData[name][childSnapshot.key] = firebaseGetFilter(
        Object.assign(
          {},
          {
            id: childSnapshot.key,
            key: childSnapshot.key,
          },
          childSnapshot.val(),
        ),
        name,
      );
    });

    ref.on('child_removed', function(oldChildSnapshot) {
      if (resourcesData[name][oldChildSnapshot.key]) {
        delete resourcesData[name][oldChildSnapshot.key];
      }
    });

    ref.on('child_changed', function(childSnapshot) {
      resourcesData[name][childSnapshot.key] = childSnapshot.val();
    });
  };

  trackedResources.map(resource => {
    resourcesStatus[resource.name] = new Promise(resolve =>
      initializeResource(resource, resolve),
    );
  });

  /**
   * @param {string} type Request type, e.g GET_LIST
   * @param {string} resourceName Resource name, e.g. "posts"
   * @param {Object} payload Request parameters. Depends on the request type
   * @returns {Promise} the Promise for a REST response
   */

  const dataProvider = async (
    type: string,
    resourceName: string,
    params: AllParams,
  ) => {
    log('start', type, resourceName, params);
    await resourcesStatus[resourceName];
    switch (type) {
      case GET_LIST:
      case GET_MANY:
      case GET_MANY_REFERENCE: {
        let result = await getMany(
          params,
          resourceName,
          resourcesData[resourceName],
        );
        log('%s %s %j %j', type, resourceName, params, result);
        return result;
      }
      case GET_ONE: {
        let result = await getOne(
          params as GetOneParams,
          resourceName,
          resourcesData[resourceName],
        );
        log('%s %s %j %j', type, resourceName, params, result);
        return result;
      }
      case DELETE: {
        const uploadFields = resourcesUploadFields[resourceName]
          ? resourcesUploadFields[resourceName]
          : [];
        let result = await del(
          (params as DeleteParams).id,
          resourceName,
          resourcesPaths[resourceName],
          resourcesData[resourceName],
          uploadFields,
          patcher,
          auditResource,
          trackedResources[trackedResourcesIndex[resourceName]],
          firebaseSaveFilter,
        );
        log('%s %s %j %j', type, resourceName, params, result);
        return result;
      }

      case DELETE_MANY: {
        const delParams = (params as DeleteManyParams).ids.map(id => ({
          id,
        }));
        const data = (
          await Promise.all(
            delParams.map(p => dataProvider(DELETE, resourceName, p)),
          )
        ).map((r: { data: { id: any } }) => r.data.id);
        let result = { data };
        log('%s %s %j %j', type, resourceName, params, result);
        return result;
      }

      case UPDATE:
      case CREATE: {
        let itemId = getItemID(
          params,
          type,
          resourceName,
          resourcesPaths[resourceName],
          resourcesData[resourceName],
        );
        const currentData = resourcesData[resourceName][itemId] || {};
        const uploads = resourcesUploadFields[resourceName]
          ? resourcesUploadFields[resourceName].map(field =>
              upload(
                field,
                (params as CreateParams).data,
                currentData,
                itemId,
                resourceName,
                resourcesPaths[resourceName],
              ),
            )
          : [];
        const uploadResults = await Promise.all(uploads);
        let result = await save(
          itemId,
          (params as CreateParams).data,
          currentData,
          resourceName,
          resourcesPaths[resourceName],
          firebaseSaveFilter,
          uploadResults,
          type === CREATE,
          timestampFieldNames,
          patcher,
          auditResource,
          trackedResources[trackedResourcesIndex[resourceName]],
        );
        log('%s %s %j %j', type, resourceName, params, result);
        return result;
      }
      case UPDATE_MANY: {
        let result;
        const updateParams = (params as DeleteManyParams).ids.map(id => ({
          id,
          data: (params as CreateParams).data,
        }));
        const data = (
          await Promise.all(
            updateParams.map(p => dataProvider(UPDATE, resourceName, p)),
          )
        ).map((r: { data: { id: any } }) => r.data.id);
        result = { data };
        log('%s %s %j %j', type, resourceName, params, result);
        return result;
      }

      case EXECUTE: {
        if (userActions && userActions.hasOwnProperty(resourceName)) {
          const data = [];
          if (params.data.record) {
            data.push(params.data.record);
          } else if (params.data.selectedIds) {
            data.push(
              ...params.data.selectedIds.map(
                r => resourcesData[params.resource][r],
              ),
            );
          }
          let result = await userActions[resourceName](
            {
              data,
              resource: params.resource,
              record: params.data.record,
              selectedIds: params.data.selectedIds,
            },
            {
              patcher,
              dataProvider,
              resourcesData,
              resourcesPaths,
              resourcesStatus,
              userActions,
              auditResource,
              timestampFieldNames,
            },
          );
          log('%s %s %j %j', type, resourceName, params, result);
          return result;
        } else {
          log('%s %s %j', type, resourceName, params);
          return;
        }
      }
      default:
        log('Undocumented method: %s', type);
        let result = { data: [] };
        log('%s %s %j %j', type, resourceName, params, result);
        return;
    }
  };
  return dataProvider;
}

export default dataConfig;
