import { createRouter, createWebHistory } from 'vue-router'
import IfcViewer from '@/components/IfcViewer.vue'
import SyncQueuePage from '@/components/SyncQueuePage.vue'
import FbxSimpleViewer from '@/components/FbxSimpleViewer.vue'
import FbxFullViewerPage from '@/components/FbxFullViewerPage.vue'
import FbxGeoRefPage from '@/components/FbxGeoRefPage.vue'
import FbxTerrainPlacementPage from '@/components/FbxTerrainPlacementPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'IfcViewer',
      component: IfcViewer,
    },
    {
      path: '/sync-queue',
      name: 'SyncQueuePage',
      component: SyncQueuePage,
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
    {
      path: '/fbx/georef',
      name: 'FbxGeoRefPage',
      component: FbxGeoRefPage,
    },
    {
      path: '/fbx/terrain-place',
      name: 'FbxTerrainPlacementPage',
      component: FbxTerrainPlacementPage,
    },
  ],
})

export default router
