import { createRouter, createWebHistory } from 'vue-router'
import Register from '@/components/Register.vue'
import Login from '@/components/Login.vue'
import Dashboard from '@/components/Dashboard.vue'



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
    {
      path: '/dashboard',
      component: Dashboard,
      // meta: {requiresAuth: true}
    }

  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) {
    return true
  }

  try {
    await axios.get('http://localhost:8000/api/me', {
      withCredentials: true
    })

    return true
  } catch {
    return { name: 'Login' }
  }
})


export default router
