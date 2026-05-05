import { Router } from 'express';
import { loginUser, registerUser, verifySession } from '../controllers/auth';
import { validateJwt } from '../middleware/auth';
import { verificarHorario } from '../middleware/verificarHorario';

const router = Router();

// Public Routes
router.post('/login', loginUser);

// Currently public, but could be protected later if only admins can register
router.post('/register', registerUser);

// Protected verification route
router.get('/verify', validateJwt, verificarHorario, verifySession);

export default router;
