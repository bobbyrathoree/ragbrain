import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'feed',
      component: () => import('@/components/views/FeedView.vue'),
    },
    {
      path: '/graph',
      name: 'graph',
      component: () => import('@/components/views/GraphView.vue'),
    },
    {
      path: '/timeline',
      name: 'timeline',
      component: () => import('@/components/views/TimelineView.vue'),
    },
    {
      path: '/stars',
      name: 'stars',
      component: () => import('@/components/views/StarsView.vue'),
    },
  ],
})

export default router
