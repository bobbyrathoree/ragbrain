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
      path: '/chat',
      name: 'chat',
      component: () => import('@/components/views/ChatView.vue'),
    },
  ],
})

export default router
