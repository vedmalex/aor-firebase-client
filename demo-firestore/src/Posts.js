import React from 'react';
import {
  Filter,
  List,
  Edit,
  Create,
  Datagrid,
  ReferenceField,
  TextField,
  EditButton,
  DisabledInput,
  LongTextInput,
  ReferenceInput,
  SelectInput,
  SimpleForm,
  TextInput,
  ImageInput,
  ImageField,
  FileInput,
  FileField,
} from 'react-admin';

const PostFilter = props => (
  <Filter {...props}>
    <TextInput label="Search" source="q" alwaysOn />
    <ReferenceInput
      label="User"
      source="userId"
      reference="profiles"
      allowEmpty
    >
      <SelectInput optionText="name" />
    </ReferenceInput>
  </Filter>
);

export const PostList = props => (
  <List {...props} filters={<PostFilter />}>
    <Datagrid>
      <TextField source="id" />
      <ReferenceField label="User" source="userId" reference="profiles">
        <TextField source="name" />
      </ReferenceField>
      <TextField source="title" />
      <TextField source="body" />
      <EditButton />
    </Datagrid>
  </List>
);

const PostTitle = ({ record }) => {
  return <span>Post {record ? `"${record.title}"` : ''}</span>;
};

export const PostEdit = props => (
  <Edit title={<PostTitle />} {...props}>
    <SimpleForm>
      <DisabledInput source="id" />
      <ReferenceInput label="User" source="userId" reference="profiles">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <TextInput source="title" />
      <LongTextInput source="body" />
      <ImageInput
        source="pictures"
        label="Related pictures"
        accept="image/*"
        multiple
      >
        <ImageField source="src" title="title" />
      </ImageInput>
      <FileInput source="file" label="Related files" accept="application/pdf">
        <FileField source="src" title="name" />
      </FileInput>
    </SimpleForm>
  </Edit>
);

export const PostCreate = props => (
  <Create {...props}>
    <SimpleForm>
      <ReferenceInput
        label="User"
        source="userId"
        reference="profiles"
        allowEmpty
      >
        <SelectInput optionText="name" />
      </ReferenceInput>
      <TextInput source="title" />
      <LongTextInput source="body" />
      <ImageInput source="pictures" label="Related pictures" accept="image/*">
        <ImageField source="src" />
      </ImageInput>
      <FileInput source="file" label="Related files" accept="application/pdf">
        <FileField source="src" title="file" />
      </FileInput>
    </SimpleForm>
  </Create>
);
