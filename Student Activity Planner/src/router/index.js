import { createRouter, createWebHistory } from 'vue-router'
import Register from '@/components/Register.vue'
import Login from '@/components/Login.vue'


const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: Login
    },
    {
      path: '/login',
      component: Login
    },
    {
      path: '/register',
      component: Register
    }, 
 

  ],
})

export default router
