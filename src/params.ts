export type GetListParams = {
  pagination: { page: number; perPage: number };
  sort: { field: string; order: string };
  filter: { [key: string]: any };
};

export type idType = string | number;
export type PayloadType = object | any;

export type FilterQuery = { [key: string]: any };

export type GetOneParams = {
  id: idType;
};

export type CreateParams = {
  data: PayloadType;
};

export type UpdateParams = {
  id: idType;
  data: PayloadType;
  previousData: PayloadType;
};

export type UpdateManyParam = {
  ids: idType[];
  data: PayloadType;
};

export type DeleteParams = {
  id: idType;
  data: PayloadType;
};

export type DeleteManyParams = {
  ids: idType[];
};

export type GetManyParams = {
  ids: idType;
};

export type GetManyReferenceParams = {
  target: string;
  id: idType;
  pagination: { page: number; perPage: number };
  sort: { field: string; order: string };
  filter: FilterQuery;
};

export type AllParams =
  | GetOneParams
  | CreateParams
  | UpdateParams
  | UpdateManyParam
  | DeleteParams
  | DeleteManyParams
  | GetManyParams
  | GetManyReferenceParams;
