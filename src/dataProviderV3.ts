import { defaultsDeep } from 'lodash';
import {
  GetOneParams,
  DeleteParams,
  CreateParams,
  DeleteManyParams,
  idType,
  GetListParams,
  GetManyParams,
  GetManyReferenceParams,
  UpdateParams,
  UpdateManyParam,
} from './params';
import * as sortBy from 'sort-by';
import { differenceBy, set, get } from 'lodash';
import { FilterData } from './filter';
import * as debug from 'debug';

const log = debug('ra-data-firestore');

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

export type ImageSize = {
  width: any;
  height: any;
};

function getImageSize(file) {
  return new Promise<ImageSize>(resolve => {
    const img = document.createElement('img');
    img.onload = function() {
      resolve({
        width: (this as HTMLImageElement).width,
        height: (this as HTMLImageElement).height,
      });
    };
    img.src = file.src;
  });
}

export type UploadFile = {
  uploadedAt: number;
  src: string;
  type: string;
  md5Hash: string;
  path: string;
  name: string;
} & Partial<ImageSize>;

export interface StoreData {
  id?: idType;
  key?: idType;
}

export interface dataProviderConfig {
  firestore: firebase.firestore.Firestore;
  storage: firebase.storage.Storage;
  getUser: () => firebase.User;
  timestampFieldNames: SystemFieldsConfigs;
  trackedResources: ResourceConfig[];
}

type subcollectionPayload = {
  name: string;
  data: StoreData[];
};

export default class {
  firestore: firebase.firestore.Firestore;
  storage: firebase.storage.Storage;
  getUser: () => firebase.User;
  timestampFieldNames: SystemFieldsConfigs;
  trackedResources: ResourceConfig[];
  trackedResourcesIndex: { [resource: string]: number };
  resourcesPaths: { [resource: string]: string };
  resourcesUploadFields: { [resource: string]: string[] };
  firebaseGetFilter(data, ..._) {
    return data;
  }
  firebaseSaveFilter(data, ..._) {
    return data;
  }

  constructor({
    firestore,
    storage,
    getUser,
    timestampFieldNames,
    trackedResources,
  }: dataProviderConfig) {
    this.firestore = firestore;
    this.storage = storage;
    this.getUser = getUser;
    this.timestampFieldNames = timestampFieldNames || {
      createdAt: 'createdAt',
      createdBy: 'createdBy',
      updatedAt: 'updatedAt',
      updatedBy: 'updatedBy',
    };
    this.trackedResources = trackedResources;

    this.trackedResourcesIndex = {};

    this.resourcesPaths = {};
    this.resourcesUploadFields = {};

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
      this.trackedResourcesIndex[name] = index;
      this.resourcesUploadFields[name] = uploadFields || [];
      this.resourcesPaths[name] = path || name;
    });
  }

  async _upload(
    fieldName: string,
    submittedData: object,
    previousData: object,
    id: string,
    resourcePath: string,
  ) {
    if (get(submittedData, fieldName) || get(previousData, fieldName)) {
      const oldFieldArray = Array.isArray(get(previousData, fieldName));
      const oldFiles = (oldFieldArray
        ? get(previousData, fieldName)
        : [get(previousData, fieldName)]
      ).filter(f => f);
      const uploadFileArray = Array.isArray(get(submittedData, fieldName));
      const files = (uploadFileArray
        ? get(submittedData, fieldName)
        : [get(submittedData, fieldName)]
      ).filter(f => f);

      const result = {};

      if (uploadFileArray) {
        set(result, fieldName, []);
      }

      files
        .filter(f => !f.rawFile)
        .forEach(f => {
          if (uploadFileArray) {
            set(result, [fieldName, files.indexOf(f)].join('.'), f);
          } else {
            set(result, fieldName, f);
          }
        });

      const rawFiles = files.filter(f => f.rawFile);
      for (let i = 0; i < rawFiles.length; i++) {
        const file = rawFiles[i];
        const index = files.indexOf(file);
        const rawFile = file.rawFile;

        if (file && rawFile && rawFile.name) {
          const ref = this.storage
            .ref()
            .child(`${resourcePath}/${id}/${fieldName}/${rawFile.name}`);

          const snapshot = await ref.put(rawFile);
          let curFile: Partial<UploadFile> = {};
          uploadFileArray
            ? set(result, [fieldName, index].join('.'), curFile)
            : set(result, fieldName, curFile);

          curFile.md5Hash = snapshot.metadata.md5Hash;
          curFile.path = snapshot.metadata.fullPath;
          curFile.name = snapshot.metadata.name;
          curFile.uploadedAt = Date.now();
          // remove token from url to make it public available
          //
          curFile.src =
            (await snapshot.ref.getDownloadURL()).split('?').shift() +
            '?alt=media';
          curFile.type = rawFile.type;
          if (rawFile.type.indexOf('image/') === 0) {
            try {
              const imageSize = await getImageSize(file);
              curFile.width = imageSize.width;
              curFile.height = imageSize.height;
            } catch (e) {
              console.error(`Failed to get image dimensions`);
            }
          }
        }
      }

      const removeFromStore = [
        ...differenceBy(oldFiles, get(result, fieldName), 'src'),
        ...differenceBy(oldFiles, get(result, fieldName), 'md5Hash'),
      ].reduce((result, cur) => {
        if (result.indexOf(cur) === -1) {
          result.push(cur);
        }
        return result;
      }, []);
      if (removeFromStore.length > 0) {
        try {
          await Promise.all(
            removeFromStore.map(file =>
              file && file.path
                ? this.storage
                    .ref()
                    .child(file.path)
                    .delete()
                : true,
            ),
          );
        } catch (e) {
          if (e.code && e.code !== 'storage/object-not-found') {
            console.error(e.code);
          } else {
            console.log(e);
          }
        }
      }

      return result;
    }
    return false;
  }

  async _subCollection(
    doc: firebase.firestore.DocumentReference,
    payload: subcollectionPayload,
  ) {
    const batch = this.firestore.batch();
    const collection = doc.collection(payload.name);
    const alreadyHas = await collection.get();

    const currentIds = payload.data.map(d => d.id);
    const allDocs = alreadyHas.docs
      .map(d => (d.exists ? d.data() : undefined))
      .filter(f => f)
      .reduce((res, doc) => {
        res[doc.id] = doc;
        return res;
      }, {}) as {
      [key: string]: firebase.firestore.DocumentData;
    };

    const currentDocs = payload.data.reduce((result, cur) => {
      result[cur.id] = cur;
      return result;
    }, {});

    const allIds = Object.keys(allDocs);

    const toDelete = Object.keys(allDocs).filter(
      key => currentIds.indexOf(key) > -1,
    );

    if (toDelete.length > 0) {
      toDelete.map(id => collection.doc(id)).map(doc => batch.delete(doc));
    }

    const toInsert = currentIds.filter(id => allIds.indexOf(id) == -1);
    if (toInsert.length > 0) {
      toInsert.map(id => {
        const doc = collection.doc(id);
        batch.set(doc, currentDocs[id]);
      });
    }
    const toUpdate = currentIds.filter(id => allIds.indexOf(id) > -1);
    if (toUpdate.length > 0) {
      toUpdate.map(id => {
        const doc = collection.doc(id);
        batch.set(doc, currentDocs[id]);
      });
    }

    await batch.commit();
  }
  async _save(
    id: idType,
    data: StoreData,
    previous: object,
    resourceName: string,
    resourcePath: string,
    firebaseSaveFilter,
    uploadResults,
    isNew,
    timestampFieldNames,
    resourceConfig: ResourceConfig,
  ) {
    const now = Date.now();
    const currentUser = this.getUser();
    if (uploadResults) {
      uploadResults.map(uploadResult =>
        uploadResult ? Object.assign(data, uploadResult) : false,
      );
    }

    if (isNew) {
      data = {
        ...data,
        [timestampFieldNames.createdAt]: now,
      };
    }

    if (isNew && currentUser) {
      data = {
        ...data,
        [timestampFieldNames.createdBy]: currentUser.uid,
      };
    }

    if (!isNew && currentUser) {
      data = {
        ...data,
        [timestampFieldNames.updatedBy]: currentUser.uid,
      };
    }

    if (!isNew) {
      data = {
        ...previous,
        ...data,
        [timestampFieldNames.updatedAt]: now,
      };
    }

    if (!data.key) {
      data.key = id;
    }

    if (!data.id) {
      data.id = id;
    }

    await this.firestore
      .collection(resourcePath)
      .doc(data.key.toString())
      .set(firebaseSaveFilter(data));
    return { data };
  }

  async _del(id, resourcePath, uploadFields) {
    if (uploadFields.length) {
      await Promise.all(
        uploadFields.map(fieldName =>
          this.storage
            .ref()
            .child(`${resourcePath}/${id}/${fieldName}`)
            .delete(),
        ),
      );
    }

    await this.firestore
      .collection(resourcePath)
      .doc(id)
      .delete();
    return { data: { id } };
  }
  _getItemID(params, resourcePath) {
    let itemId = params.data.id || params.id || params.data.key || params.key;
    if (!itemId) {
      itemId = this.firestore.collection(resourcePath).doc().id;
    }
    return itemId;
  }
  async _getOne(params: GetOneParams, resourceName: string) {
    if (params.id) {
      let result = await this.firestore
        .collection(resourceName)
        .doc(params.id.toString())
        .get();

      if (result.exists) {
        const data = result.data();

        if (data && data.id == null) {
          data['id'] = result.id;
        }
        return { data: data };
      } else {
        throw new Error('Id not found');
      }
    } else {
      throw new Error('Key not found');
    }
  }

  async _getMany(params, resourceName) {
    let data = [];
    for await (let items of sliceArray(params.ids, 10)) {
      data.push(
        ...(
          await this.firestore
            .collection(resourceName)
            .where('id', 'in', items)
            .get()
        ).docs,
      );
    }
    return { data };
  }
  async _getManyReference(
    resourceName: string,
    params: GetManyReferenceParams,
  ) {
    if (params.target) {
      if (!params.filter) params.filter = {};
      params.filter[params.target] = params.id;
      let { data, total } = await this._getList(params, resourceName);
      return { data, total };
    } else {
      throw new Error('Error processing request');
    }
  }

  async _getListNative(params: GetListParams, resourceName) {
    let query = this.firestore
      .collection(resourceName)
      .orderBy(params.sort.field, params.sort.order == 'ASC' ? 'asc' : 'desc');

    query = filterQuery(query, params.filter);

    let snapshots = await query.get();

    const values = snapshots.docs.map(s => s.data());

    const { page, perPage } = params.pagination;
    const _start = (page - 1) * perPage;
    const _end = page * perPage;
    const data = values ? values.slice(_start, _end) : [];
    const total = values ? values.length : 0;
    return { data, total };
  }

  async _getList(params: GetListParams, resourceName) {
    let snapshots = await this.firestore.collection(resourceName).get();

    const result = snapshots.docs.map(s => s.data());

    const values: any[] = Object.values(result).filter(
      makeFilter(params.filter),
    );

    if (params.sort) {
      values.sort(
        sortBy(`${params.sort.order === 'ASC' ? '-' : ''}${params.sort.field}`),
      );
    }
    const { page, perPage } = params.pagination;
    const _start = (page - 1) * perPage;
    const _end = page * perPage;
    const data = values ? values.slice(_start, _end) : [];
    const total = values ? values.length : 0;
    return {
      data,
      total,
    };
  }

  async getList(resource: string, params: GetListParams) {
    const result = await this._getList(params, this.resourcesPaths[resource]);
    log('getList %s %j %j', resource, params, result);
    return {
      data: result.data.map(d => this.firebaseGetFilter(d, resource)),
      total: result.total,
    };
  }
  async getOne(resource: string, params: GetOneParams) {
    let result = await this._getOne(
      params as GetOneParams,
      this.resourcesPaths[resource],
    );
    log('getOne %s %j %j', resource, params, result);
    return {
      data: this.firebaseGetFilter(result.data, resource),
    };
  }
  async getMany(resource: string, params: GetManyParams) {
    let result = await this._getMany(params, this.resourcesPaths[resource]);
    log('getMany %s %j %j', resource, params, result);
    return {
      data: result.data.map(d => this.firebaseGetFilter(d, resource)),
    };
  }
  async getManyReference(resource: string, params: GetManyReferenceParams) {
    const result = await this._getManyReference(
      this.resourcesPaths[resource],
      params,
    );
    log('getManyReference %s %j %j', resource, params, result);
    return {
      data: result.data.map(d => this.firebaseGetFilter(d, resource)),
      total: result.total,
    };
  }
  async _createOrUpdate(
    resource: string,
    params: CreateParams,
    create: boolean,
  ) {
    let itemId = this._getItemID(params, this.resourcesPaths[resource]);
    const item = await this.firestore
      .collection(this.resourcesPaths[resource])
      .doc(itemId)
      .get();
    const currentData = item.exists ? item.data() : {};
    const uploads = this.resourcesUploadFields[resource]
      ? this.resourcesUploadFields[resource].map(field =>
          this._upload(
            field,
            (params as CreateParams).data,
            currentData,
            itemId,
            this.resourcesPaths[resource],
          ),
        )
      : [];

    const uploadResults = await Promise.all(uploads);
    let result = await this._save(
      itemId,
      (params as CreateParams).data,
      currentData,
      resource,
      this.resourcesPaths[resource],
      this.firebaseSaveFilter,
      uploadResults,
      create,
      this.timestampFieldNames,
      this.trackedResources[this.trackedResourcesIndex[resource]],
    );
    log('%s %s %j %j', create ? 'create' : 'update', resource, params, result);
    return this.firebaseGetFilter(result, resource);
  }
  async create(resource: string, params: UpdateParams) {
    return this._createOrUpdate(resource, params, true);
  }
  async update(resource: string, params: UpdateParams) {
    return this._createOrUpdate(resource, params, false);
  }
  async updateMany(resource: string, params: UpdateManyParam) {
    let result;
    const updateParams = params.ids.map(id => ({
      id,
      data: (params as CreateParams).data,
    }));
    const data = await Promise.all(
      updateParams.map(p => this.update(resource, p)),
    ).then(r => r.map(d => d.data.id));
    result = { data };
    log('updateMany %s %j %j', resource, params, result);
    return result;
  }
  async delete(resource: string, params: DeleteParams) {
    const uploadFields = this.resourcesUploadFields[resource]
      ? this.resourcesUploadFields[resource]
      : [];
    let result = await this._del(
      params.id,
      this.resourcesPaths[resource],
      uploadFields,
    );
    log('delete %s %j %j', resource, params, result);
    return result;
  }

  async deleteMany(resource: string, params: DeleteManyParams) {
    const delParams = params.ids.map(id => ({
      id,
    }));
    const data = (
      await Promise.all(delParams.map(p => this.delete(resource, p)))
    ).map((r: { data: { id: any } }) => r.data.id);
    let result = { data };
    log('deleteMany %s %j %j', resource, params, result);
    return result;
  }
}

function prepareFilter(args) {
  return typeof args === 'object' && !Array.isArray(args)
    ? Object.keys(args).reduce((acc, key) => {
        if (key === 'ids') {
          return {
            ...acc,
            id: { in: this.prepareFilter(args[key]) },
          };
        }
        if (key === 'q') {
          return {
            ...acc,
            or: [
              {
                '*': { imatch: this.prepareFilter(args[key]) },
              },
            ],
          };
        }
        return set(acc, key.replace('-', '.'), this.prepareFilter(args[key]));
      }, {})
    : args;
}

function makeFilter(args) {
  const filter = prepareFilter(args);
  return FilterData.create(filter);
}

function filterQuery(
  query: firebase.firestore.Query,
  filter: {
    [filter: string]: any;
  },
): firebase.firestore.Query {
  let result: firebase.firestore.Query = query;
  Object.keys(filter).forEach(key => {
    const [field, op] = key.split('-');
    switch (op) {
      case 'eq':
      case undefined:
        result = result.where(field, '==', filter[key]);
        break;
      case 'lt':
        result = result.where(field, '<', filter[key]);
        break;
      case 'gt':
        result = result.where(field, '>', filter[key]);
        break;
      case 'lte':
        result = result.where(field, '<=', filter[key]);
        break;
      case 'gte':
        result = result.where(field, '>=', filter[key]);
        break;
      case 'in':
        result = result.where(field, 'in', filter[key]);
        break;
    }
  });
  return result;
}

function* sliceArray(array: any[], limit) {
  if (array.length <= limit) {
    return [...array];
  } else {
    const current = [...array];
    while (true) {
      if (current.length === 0) {
        return;
      } else {
        yield array.splice(0, limit - 1);
      }
    }
  }
}
