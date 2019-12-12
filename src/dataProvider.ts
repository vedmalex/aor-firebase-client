import * as firebase from 'firebase/app';
import 'firebase/firestore';
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
  name: string;
  path: string;
  isPublic?: boolean;
  uploadFields: string[];
  collections?: (string | ResourceConfig)[];
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
  trackedResources: ResourceConfig[];
  firebaseSaveFilter: (data, name?) => any;
  firebaseGetFilter: (data, name?) => any;
} & typeof Methods;

const BaseConfiguration: Partial<DataConfig> = {
  initialQueryTimeout: 10000,
  timestampFieldNames: {
    createdAt: 'createdAt',
    createdBy: 'createdBy',
    updatedAt: 'updatedAt',
    updatedBy: 'updatedBy',
  },
};

export type ResourceStore = {
  [key: string]: { [field: string]: any; id: string; key: string };
};

export type ResourceDataStore = {
  [resource: string]: ResourceStore;
};

function dataConfig(firebaseConfig = {}, options: Partial<DataConfig> = {}) {
  options = defaultsDeep(options, BaseConfiguration);
  const { debug, timestampFieldNames, trackedResources } = options;
  if (debug && localStorage) {
    localStorage.debug = 'ra-data-firestore';
  }
  const trackedResourcesIndex = {};
  const noDiff = [timestampFieldNames.updatedAt, timestampFieldNames.createdAt];

  const resourcesStatus = {};
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
  const getManyReference = options.getManyReference || Methods.getManyReference;
  const getList = options.getList || Methods.getList;

  const firebaseSaveFilter = options.firebaseSaveFilter
    ? options.firebaseSaveFilter
    : data => data;
  const firebaseGetFilter = options.firebaseGetFilter
    ? options.firebaseGetFilter
    : data => data;

  debugger;
  // Sanitize Resources
  trackedResources.map((resource, index) => {
    if (typeof resource === 'string') {
      resource = {
        name: resource,
        path: resource,
        uploadFields: [],
      };
      trackedResources[index] = resource;
    } else {
      defaultsDeep(resource, {
        name: resource.name || resource.path,
        path: resource.path || resource.name,
        uploadFields: [],
      });
    }
    const { name, path, uploadFields } = resource;
    trackedResourcesIndex[name] = index;

    if (!resource.name) {
      throw new Error(`name is missing from resource ${resource}`);
    }
    resourcesUploadFields[name] = uploadFields || [];
    resourcesPaths[name] = path || name;
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
      case GET_MANY_REFERENCE: {
        const result = await getManyReference(
          params,
          resourcesPaths[resourceName],
        );
        log('%s %s %j %j', type, resourceName, params, result);
        return {
          data: result.data.map(d => firebaseGetFilter(d, resourceName)),
        };
      }
      case GET_LIST: {
        const result = await getList(params, resourcesPaths[resourceName]);
        log('%s %s %j %j', type, resourceName, params, result);
        return {
          data: result.data.map(d => firebaseGetFilter(d, resourceName)),
          total: result.total,
        };
      }
      case GET_MANY: {
        let result = await getMany(params, resourcesPaths[resourceName]);
        log('%s %s %j %j', type, resourceName, params, result);
        return {
          data: result.data.map(d => firebaseGetFilter(d, resourceName)),
        };
      }
      case GET_ONE: {
        let result = await getOne(
          params as GetOneParams,
          resourcesPaths[resourceName],
        );
        log('%s %s %j %j', type, resourceName, params, result);
        return {
          data: firebaseGetFilter(result.data, resourceName),
        };
      }
      case DELETE: {
        const uploadFields = resourcesUploadFields[resourceName]
          ? resourcesUploadFields[resourceName]
          : [];
        let result = await del(
          (params as DeleteParams).id,
          resourcesPaths[resourceName],
          uploadFields,
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
        let itemId = getItemID(params, resourcesPaths[resourceName]);
        const item = await firebase
          .firestore()
          .collection(resourcesPaths[resourceName])
          .doc(itemId)
          .get();
        const currentData = item.exists ? item.data() : {};
        debugger;
        const uploads = resourcesUploadFields[resourceName]
          ? resourcesUploadFields[resourceName].map(field =>
              upload(
                field,
                (params as CreateParams).data,
                currentData,
                itemId,
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
          trackedResources[trackedResourcesIndex[resourceName]],
        );
        log('%s %s %j %j', type, resourceName, params, result);
        return firebaseGetFilter(result, resourceName);
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
