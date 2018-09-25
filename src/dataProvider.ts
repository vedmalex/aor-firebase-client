import * as firebase from 'firebase';
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
  DELETE,
  DELETE_MANY,
  EXECUTE,
} from './reference';
import { defaultsDeep } from 'lodash';
import { DiffPatcher } from 'jsondiffpatch';

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
    timestampFieldNames,
    trackedResources,
    initialQueryTimeout,
    auditResource,
    userActions,
  } = options;

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
  const delMany = options.delMany || Methods.delMany;
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
    await resourcesStatus[resourceName];
    let result = null;
    switch (type) {
      case GET_LIST:
      case GET_MANY:
      case GET_MANY_REFERENCE:
        result = await getMany(
          params,
          resourceName,
          resourcesData[resourceName],
        );
        return result;

      case GET_ONE:
        result = await getOne(
          params as GetOneParams,
          resourceName,
          resourcesData[resourceName],
        );
        return result;

      case DELETE: {
        const uploadFields = resourcesUploadFields[resourceName]
          ? resourcesUploadFields[resourceName]
          : [];
        result = await del(
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
        return result;
      }

      case DELETE_MANY: {
        const uploadFields = resourcesUploadFields[resourceName]
          ? resourcesUploadFields[resourceName]
          : [];
        result = await delMany(
          (params as DeleteManyParams).ids,
          resourceName,
          resourcesPaths[resourceName],
          resourcesData[resourceName],
          uploadFields,
          patcher,
          auditResource,
          trackedResources[trackedResourcesIndex[resourceName]],
          firebaseSaveFilter,
        );
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
        result = await save(
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
        return result;
      }
      case EXECUTE: {
        if (userActions && userActions.hasOwnProperty(resourceName)) {
          await userActions[resourceName](params, {
            patcher,
            dataProvider,
            resourcesData,
            resourcesPaths,
            resourcesStatus,
            userActions,
            auditResource,
            timestampFieldNames,
          });
        } else {
          return;
        }
      }
      default:
        console.error('Undocumented method: ', type);
        return { data: [] };
    }
  };
  return dataProvider;
}

export default dataConfig;
