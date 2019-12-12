import * as firebase from 'firebase';
import 'firebase/auth';
import 'firebase/firestore';
import 'firebase/storage';

import * as sortBy from 'sort-by';
import { differenceBy, set, get } from 'lodash';
import { GetOneParams, idType } from './params';
import { ResourceConfig, ResourceStore } from './dataProvider';
import { FilterData } from './filter';
import undefined = require('firebase/auth');

export type ImageSize = {
  width: any;
  height: any;
};

export interface StoreData {
  id?: idType;
  key?: idType;
}

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

// удалять старые файлы если они были удалены из upload-а
// посмотреть на дубликаты

async function upload(
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
        const ref = firebase
          .storage()
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
              ? firebase
                  .storage()
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

type subcollectionPayload = {
  name: string;
  data: StoreData[];
};

async function subCollection(
  doc: firebase.firestore.DocumentReference,
  payload: subcollectionPayload,
) {
  const batch = firebase.firestore().batch();
  const collection = doc.collection(payload.name);
  const alreadyHas = await collection.get();

  const currentIds = payload.data.map(d => d.id);
  const allDocs = alreadyHas.docs
    .map(d => (d.exists ? d.data() : undefined))
    .filter(f => f)
    .reduce((res, doc) => {
      res[doc.id] = doc;
      return res;
    }, {}) as { [key: string]: firebase.firestore.DocumentData };

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

const save = async (
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
) => {
  const now = Date.now();
  const currentUser = firebase.auth().currentUser;
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

  await firebase
    .firestore()
    .collection(resourcePath)
    .doc(data.key.toString())
    .set(firebaseSaveFilter(data));
  return { data };
};

const del = async (id, resourcePath, uploadFields) => {
  if (uploadFields.length) {
    await Promise.all(
      uploadFields.map(fieldName =>
        firebase
          .storage()
          .ref()
          .child(`${resourcePath}/${id}/${fieldName}`)
          .delete(),
      ),
    );
  }

  await firebase
    .firestore()
    .collection(resourcePath)
    .doc(id)
    .delete();
  return { data: { id } };
};

const getItemID = (params, resourcePath) => {
  let itemId = params.data.id || params.id || params.data.key || params.key;
  if (!itemId) {
    itemId = firebase
      .firestore()
      .collection(resourcePath)
      .doc().id;
  }
  return itemId;
};

const getOne = async (params: GetOneParams, resourceName: string) => {
  if (params.id) {
    let result = await firebase
      .firestore()
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
};

// const PrepareFilter = args => {
//   const filter = Object.keys(args).reduce((acc, key) => {
//     if (key === 'ids') {
//       return { ...acc, id: { in: args[key] } };
//     }
//     if (key === 'q') {
//       return {
//         ...acc,
//         or: [{ '*': { imatch: args[key] } }],
//       };
//     }
//     return set(acc, key.replace('-', '.'), args[key]);
//   }, {});
//   return FilterData.create(filter);
// };

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

const getMany = async (params, resourceName) => {
  let data = [];
  for await (let items of sliceArray(params.ids, 10)) {
    data.push(
      ...(
        await firebase
          .firestore()
          .collection(resourceName)
          .where('id', 'in', items)
          .get()
      ).docs,
    );
  }
  return { data };
};

type getManyReferenceParams = {
  target: string;
  id: any;
  sort: {
    field: string;
    order: 'ASC' | 'DESC';
  };
  pagination: {
    page: number;
    perPage: number;
  };
  filter: {
    [filter: string]: any;
  };
};

const getManyReference = async (
  params: getManyReferenceParams,
  resourceName: string,
) => {
  if (params.target) {
    if (!params.filter) params.filter = {};
    params.filter[params.target] = params.id;
    let { data, total } = await getList(params, resourceName);
    return { data, total };
  } else {
    throw new Error('Error processing request');
  }
};

type getListParams = {
  sort: {
    field: string;
    order: 'ASC' | 'DESC';
  };
  pagination: {
    page: number;
    perPage: number;
  };
  filter: {
    [filter: string]: any;
  };
};

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

const getList = async (params: getListParams, resourceName) => {
  let query = firebase
    .firestore()
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
};

// const _getMany = async (params, resourceName, resourceData: ResourceStore) => {
//   let data = [];
//   let total = 0;

//   if (params.ids) {
//     /** GET_MANY */
//     params.ids.map(key => {
//       if (resourceData[key]) {
//         data.push(resourceData[key]);
//         total++;
//       }
//       return total;
//     });
//     return { data, total };
//   } else if (params.pagination) {
//     /** GET_LIST / GET_MANY_REFERENCE */
//     // let values = [];

//     // Copy the filter params so we can modify for GET_MANY_REFERENCE support.
//     const filter = params.filter;

//     if (params.target && params.id) {
//       filter[params.target] = params.id;
//     }

//     const values: any[] = Object.values(resourceData).filter(
//       PrepareFilter(filter),
//     );

//     if (params.sort) {
//       values.sort(
//         sortBy(`${params.sort.order === 'ASC' ? '-' : ''}${params.sort.field}`),
//       );
//     }

//     const keys = values.map(i => i.id);
//     const { page, perPage } = params.pagination;
//     const _start = (page - 1) * perPage;
//     const _end = page * perPage;
//     data = values.slice(_start, _end);
//     total = values.length;
//     return { data, total };
//   } else {
//     throw new Error('Error processing request');
//   }
// };

export default {
  upload,
  save,
  del,
  getItemID,
  getOne,
  getMany,
  getManyReference,
  getList,
};
