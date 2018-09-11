// @ts-check
import React from 'react';
import { Admin, Resource } from 'react-admin';
import { DataProvider, AuthProvider } from 'ra-data-firebase';

import { PostList, PostEdit, PostCreate } from './Posts';
import { UserList } from './Users';

const firebaseConfig = {
  apiKey: 'AIzaSyA9tDafh6m3NeK6nArV-PKW6hegaV-cy2A',
  authDomain: 'disciples-db.firebaseapp.com',
  databaseURL: 'https://disciples-db.firebaseio.com',
  projectId: 'disciples-db',
  storageBucket: 'disciples-db.appspot.com',
  messagingSenderId: '540696597264',
};

const authConfig = {
  userProfilePath: 'profiles/',
  userAdminProp: 'superuser',
};

const trackedResources = [
  {
    path: 'posts',
    name: 'posts',
    uploadFields: ['pictures', 'file'],
  },
  'profiles',
];

const App = () => (
  <Admin
    dataProvider={DataProvider(firebaseConfig, { trackedResources })}
    authProvider={null}
  >
    <Resource
      name="posts"
      list={PostList}
      edit={PostEdit}
      create={PostCreate}
    />
    <Resource name="profiles" list={UserList} />
  </Admin>
);

export default App;
