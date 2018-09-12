// @ts-check
import React from 'react';
import { Admin, Resource } from 'react-admin';
import { DataProvider, AuthProvider } from 'ra-data-firestore';

import { PostList, PostEdit, PostCreate } from './Posts';
import { UserList } from './Users';

const firebaseConfig = {
  apiKey: 'AIzaSyBLLT5OA7xabMpqfyMr2mOlIVjpnRzyspY',
  authDomain: 'firestore-rest-test.firebaseapp.com',
  databaseURL: 'https://firestore-rest-test.firebaseio.com',
  projectId: 'firestore-rest-test',
  storageBucket: 'firestore-rest-test.appspot.com',
  messagingSenderId: '579194619457',
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
    authProvider={AuthProvider(authConfig)}
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
