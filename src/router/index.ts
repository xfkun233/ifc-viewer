import { createRouter, createWebHistory } from 'vue-router'
import IfcViewer from '@/components/IfcViewer.vue'
import FbxSimpleViewer from '@/components/FbxSimpleViewer.vue'
import FbxFullViewerPage from '@/components/FbxFullViewerPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'IfcViewer',
      component: IfcViewer,
    },
    {
      path: '/fbx',
      redirect: '/fbx/simple',
    },
    {
      path: '/fbx/simple',
      name: 'FbxSimpleViewer',
      component: FbxSimpleViewer,
    },
    {
      path: '/fbx/full',
      name: 'FbxFullViewerPage',
      component: FbxFullViewerPage,
    },
  ],
})

export default router
