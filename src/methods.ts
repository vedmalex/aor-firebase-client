import * as firebase from 'firebase';
import * as sortBy from 'sort-by';
import { differenceBy } from 'lodash';
import { CREATE } from './reference';
import { GetOneParams } from './params';

export type ImageSize = {
  width: any;
  height: any;
};

export interface StoreData {
  id?: string;
  key?: string;
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
  submitedData: object,
  previousData: object,
  id: string,
  resourceName: string,
  resourcePath: string,
) {
  if (submitedData[fieldName]) {
    const oldFieldArray = Array.isArray(previousData[fieldName]);
    const oldFiles = oldFieldArray
      ? previousData[fieldName]
      : [previousData[fieldName]];
    const uploadFileArray = Array.isArray(submitedData[fieldName]);
    const files = uploadFileArray
      ? submitedData[fieldName]
      : [submitedData[fieldName]];

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
  id: string,
  data: StoreData,
  previous: object,
  resourceName: string,
  resourcePath: string,
  firebaseSaveFilter,
  uploadResults,
  isNew,
  timestampFieldNames,
) => {
  if (uploadResults) {
    uploadResults.map(
      uploadResult =>
        uploadResult ? Object.assign(data, uploadResult) : false,
    );
  }

  if (isNew) {
    Object.assign(data, { [timestampFieldNames.createdAt]: Date.now() });
  }

  data = Object.assign(
    previous,
    { [timestampFieldNames.updatedAt]: Date.now() },
    data,
  );

  if (!data.key) {
    data.key = id;
  }
  if (!data.id) {
    data.id = id;
  }

  await firebase
    .database()
    .ref(`${resourcePath}/${data.key}`)
    .update(firebaseSaveFilter(data));
  return { data };
};

const del = async (id, resourceName, resourcePath, uploadFields) => {
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
    .database()
    .ref(`${resourcePath}/${id}`)
    .remove();
  return { data: { id } };
};

const delMany = () => {};

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

const getMany = (params, resourceName, resourceData) => {
  let ids = [];
  let data = [];
  let total = 0;

  if (params.ids) {
    /** GET_MANY */
    params.ids.map(key => {
      if (resourceData[key]) {
        ids.push(key);
        data.push(resourceData[key]);
        total++;
      }
      return total;
    });
    return { data, ids, total };
  } else if (params.pagination) {
    /** GET_LIST / GET_MANY_REFERENCE */
    let values = [];

    // Copy the filter params so we can modify for GET_MANY_REFERENCE support.
    const filter = Object.assign({}, params.filter);

    if (params.target && params.id) {
      filter[params.target] = params.id;
    }

    const filterKeys = Object.keys(filter);
    /* TODO Must have a better way */
    if (filterKeys.length) {
      Object.values(resourceData).map(value => {
        let filterIndex = 0;
        while (filterIndex < filterKeys.length) {
          let property = filterKeys[filterIndex];
          if (property !== 'q' && value[property] !== filter[property]) {
            return filterIndex;
          } else if (property === 'q') {
            if (JSON.stringify(value).indexOf(filter['q']) === -1) {
              return filterIndex;
            }
          }
          filterIndex++;
        }
        values.push(value);
        return filterIndex;
      });
    } else {
      values = Object.values(resourceData);
    }

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
    ids = keys.slice(_start, _end);
    total = values.length;
    return { data, ids, total };
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
