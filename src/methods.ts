import * as firebase from 'firebase';
import * as sortBy from 'sort-by';
import { differenceBy, set, get } from 'lodash';
import { CREATE } from './reference';
import { GetOneParams, idType } from './params';
import { DiffPatcher } from 'jsondiffpatch';
import { ResourceConfig, ResourceStore } from './dataProvider';
import { FilterData } from './filter';

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
  resourceName: string,
  resourcePath: string,
) {
  if (submittedData[fieldName]) {
    const oldFieldArray = Array.isArray(previousData[fieldName]);
    const oldFiles = oldFieldArray
      ? previousData[fieldName]
      : [previousData[fieldName]];
    const uploadFileArray = Array.isArray(submittedData[fieldName]);
    const files = uploadFileArray
      ? submittedData[fieldName]
      : [submittedData[fieldName]];

    const result = {};

    if (uploadFileArray) {
      result[fieldName] = [];
    }

    files.filter(f => !f.rawFile).forEach(f => {
      if (uploadFileArray) {
        result[fieldName][files.indexOf(f)] = f;
      } else {
        result[fieldName] = f;
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
        let curFile: Partial<UploadFile> = uploadFileArray
          ? (result[fieldName][index] = {})
          : (result[fieldName] = {});
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
    //remove oldFiles && dedupe
    // добавить метаданные для определения названия файла или имя файла можно определять по url!!!!
    // файлы передавать в папках
    const removeFromStore = [
      ...differenceBy(oldFiles, result[fieldName], 'src'),
      ...differenceBy(oldFiles, result[fieldName], 'md5Hash'),
    ];
    if (removeFromStore.length > 0) {
      try {
        await Promise.all(
          removeFromStore.map(
            file =>
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
  patcher: DiffPatcher,
  auditResource: string,
  resourceConfig: ResourceConfig,
) => {
  const now = Date.now();
  const dataCopy = patcher.clone(data);
  const currentUser = firebase.auth().currentUser;
  if (uploadResults) {
    uploadResults.map(
      uploadResult =>
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

  let changes: object | boolean = resourceConfig.audit ? undefined : true;
  if (resourceConfig.audit) {
    if (!isNew) {
      const exist = await firebase
        .database()
        .ref(
          `${auditResource}/${resourcePath}/${data.key}/${
            previous[timestampFieldNames.updatedAt]
          }`,
        )
        .once('value');

      changes = exist.val()
        ? patcher.diff(firebaseSaveFilter(previous), {
            ...previous,
            ...dataCopy,
          })
        : patcher.diff({}, firebaseSaveFilter(data));
      // https://firebase.google.com/docs/reference/js/firebase.database.Reference#transaction
    } else {
      changes = patcher.diff({}, firebaseSaveFilter(dataCopy));
    }

    if (changes) {
      await firebase
        .database()
        .ref(
          `${auditResource}/${resourcePath}/${data.key}/${
            data[timestampFieldNames.updatedAt]
          }`,
        )
        .update(changes);
    }
  }

  if (changes) {
    await firebase
      .database()
      .ref(`${resourcePath}/${data.key}`)
      .update(firebaseSaveFilter(data));
  }
  return { data };
};

const del = async (
  id,
  resourceName,
  resourcePath,
  resourceData,
  uploadFields,
  patcher: DiffPatcher,
  auditResource: string,
  resourceConfig: ResourceConfig,
  firebaseSaveFilter: (data) => any,
) => {
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

  if (resourceConfig.audit) {
    await firebase
      .database()
      .ref(`${auditResource}/${resourcePath}/${id}/${Date.now()}`)
      .set(patcher.diff(firebaseSaveFilter(resourceData[id]), {}));
  }
  await firebase
    .database()
    .ref(`${resourcePath}/${id}`)
    .remove();
  return { data: { id } };
};

const getItemID = (params, type, resourceName, resourcePath, resourceData) => {
  let itemId = params.data.id || params.id || params.data.key || params.key;
  if (!itemId) {
    itemId = firebase
      .database()
      .ref()
      .child(resourcePath)
      .push().key;
  }

  if (!itemId) {
    throw new Error('ID is required');
  }

  if (resourceData && resourceData[itemId] && type === CREATE) {
    throw new Error('ID already in use');
  }

  return itemId;
};

const getOne = (
  params: GetOneParams,
  resourceName: string,
  resourceData: object,
) => {
  if (params.id && resourceData[params.id]) {
    return { data: resourceData[params.id] };
  } else {
    throw new Error('Key not found');
  }
};

const PrepareFilter = args => {
  const filter = Object.keys(args).reduce((acc, key) => {
    if (key === 'ids') {
      return { ...acc, id: { in: args[key] } };
    }
    if (key === 'q') {
      return {
        ...acc,
        or: [{ '*': { imatch: args[key] } }],
      };
    }
    return set(acc, key.replace('-', '.'), args[key]);
  }, {});
  return FilterData.create(filter);
};

const getMany = (params, resourceName, resourceData: ResourceStore) => {
  let data = [];
  let total = 0;

  if (params.ids) {
    /** GET_MANY */
    params.ids.map(key => {
      if (resourceData[key]) {
        data.push(resourceData[key]);
        total++;
      }
      return total;
    });
    return { data, total };
  } else if (params.pagination) {
    /** GET_LIST / GET_MANY_REFERENCE */
    // let values = [];

    // Copy the filter params so we can modify for GET_MANY_REFERENCE support.
    const filter = params.filter;

    if (params.target && params.id) {
      filter[params.target] = params.id;
    }

    const values: any[] = Object.values(resourceData).filter(
      PrepareFilter(filter),
    );

    if (params.sort) {
      values.sort(
        sortBy(`${params.sort.order === 'ASC' ? '-' : ''}${params.sort.field}`),
      );
    }

    const keys = values.map(i => i.id);
    const { page, perPage } = params.pagination;
    const _start = (page - 1) * perPage;
    const _end = page * perPage;
    data = values.slice(_start, _end);
    total = values.length;
    return { data, total };
  } else {
    throw new Error('Error processing request');
  }
};

export default {
  upload,
  save,
  del,
  getItemID,
  getOne,
  getMany,
};
