import { createRouter, createWebHistory } from 'vue-router'
import IfcViewer from '@/components/IfcViewer.vue'
import FBXPlayer from '@/components/FBXPlayer.vue'

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
      name: 'FBXPlayer',
      component: FBXPlayer,
    },
  ],
})

export default router
