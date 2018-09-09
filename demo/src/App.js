import React from 'react'
import { Admin, Resource } from 'react-admin'
import { RestClient, AuthClient } from 'ra-firebase-client'

import { PostList, PostEdit, PostCreate } from './Posts'
import { UserList } from './Users'

const firebaseConfig = {
  apiKey: 'AIzaSyA9tDafh6m3NeK6nArV-PKW6hegaV-cy2A',
  authDomain: 'disciples-db.firebaseapp.com',
  databaseURL: 'https://disciples-db.firebaseio.com',
  projectId: 'disciples-db',
  storageBucket: 'disciples-db.appspot.com',
  messagingSenderId: '540696597264'
}

const authConfig = {
  userProfilePath: 'profiles',
  userAdminProp: 'superuser'
}

const trackedResources = [
  {
    name: 'posts',
    path: 'posts',
    isPublic: true
  },
  {
    name: 'profiles',
    path: 'profiles',
    isPublic: true
  }
]

const App = () => (
  <Admin
    dataProvider={RestClient(firebaseConfig, { trackedResources })}
    authProvider={AuthClient(authConfig)}
  >
    <Resource
      name='posts'
      list={PostList}
      edit={PostEdit}
      create={PostCreate}
    />
    <Resource name='profiles' list={UserList} />
  </Admin>
)

export default App
