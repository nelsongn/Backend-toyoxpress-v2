import { Router } from 'express';
import { uploadClientes, getClientes } from '../controllers/clientes';
import { validateJwt, requirePermission } from '../middleware/auth';

const router = Router();

// /api/clientes — all routes require authentication
router.use(validateJwt);

router.get('/', requirePermission('verPedidos'), getClientes);
router.post('/upload', requirePermission('verClientes'), uploadClientes);

export default router;
