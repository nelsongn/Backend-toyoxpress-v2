import { Router } from 'express';
import { uploadClientes, getClientes } from '../controllers/clientes';
import { validateJwt, requirePermission } from '../middleware/auth';

const router = Router();

// /api/clientes — all routes require authentication
router.use(validateJwt);

router.get('/', getClientes);
router.post('/upload', requirePermission('cargarProductos'), uploadClientes);

export default router;
