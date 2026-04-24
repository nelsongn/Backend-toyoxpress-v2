import { Request, Response } from 'express';
import User from '../models/User';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Configuracion } from '../models/Configuracion';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey_dev_only_change_me';

export const loginUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body; // email field here acts as a generic identifier

        if (!email || !password) {
            res.status(400).json({ success: false, message: 'Faltan credenciales' });
            return;
        }

        const user = await User.findOne({
            $or: [
                { email: email },
                { username: email }
            ]
        });

        if (!user) {
            res.status(403).json({ success: false, message: 'Usuario y/o contraseña inválida' });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password as string);
        if (!isMatch) {
            res.status(403).json({ success: false, message: 'Usuario y/o contraseña inválida' });
            return;
        }

        let effectivePermissions = user.permissions;

        // Superuser override: "admin" gets all permissions automatically
        if (user.username === 'admin') {
            effectivePermissions = {
                verMovimientos: true,
                verOtrosMovimientos: true,
                aprobarMovimientos: true,
                editarMovimientos: true,
                eliminarMovimientos: true,
                modificarFechas: true,
                crearUsuarios: true,
                modificarUsuarios: true,
                eliminarUsuarios: true,
                horasIngreso: true,
                obviarIngreso: true,
                configurarCuentas: true,
                consultarPrecios: true,
                verClientes: true,
                verExcel: true,
                cargarProductos: true,
                verPedidos: true
            };
        }

        // Generate JWT including basic user info and permissions
        // --- HORARIO VALIDATION ---
        if (!effectivePermissions?.obviarIngreso) {
            const config = await Configuracion.findOne();
            if (config && config.horario) {
                // Get current time in Caracas
                const now = new Date();
                const formatter = new Intl.DateTimeFormat('es-VE', {
                    timeZone: 'America/Caracas',
                    weekday: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                const parts = formatter.formatToParts(now);

                let currentDayStr = '';
                let currentHour = 0;
                let currentMin = 0;

                for (const part of parts) {
                    if (part.type === 'weekday') currentDayStr = part.value;
                    if (part.type === 'hour') currentHour = parseInt(part.value, 10);
                    if (part.type === 'minute') currentMin = parseInt(part.value, 10);
                }

                // Map 'lunes' -> 'Lunes'
                const dayMap: Record<string, string> = {
                    'lunes': 'Lunes', 'martes': 'Martes', 'miércoles': 'Miércoles',
                    'jueves': 'Jueves', 'viernes': 'Viernes', 'sábado': 'Sábado', 'domingo': 'Domingo'
                };
                const dayKey = dayMap[currentDayStr.toLowerCase()] || 'Lunes';

                const todaySchedule = config.horario.find((h: any) => h.dia === dayKey);

                if (todaySchedule) {
                    if (todaySchedule.cerrado) {
                        res.status(403).json({ success: false, message: 'La tienda se encuentra cerrada el día de hoy.' });
                        return;
                    }

                    const [openH, openM] = todaySchedule.apertura.split(':').map(Number);
                    const [closeH, closeM] = todaySchedule.cierre.split(':').map(Number);

                    const nowMins = currentHour * 60 + currentMin;
                    const openMins = (openH || 0) * 60 + (openM || 0);
                    const closeMins = (closeH || 23) * 60 + (closeM || 59);

                    // Si el cierre es "menor" a la apertura, significa que cierra al día siguiente (ej. 20:00 a 02:00)
                    const isOvernight = closeMins < openMins;

                    let isOpen = false;
                    if (isOvernight) {
                        isOpen = nowMins >= openMins || nowMins <= closeMins;
                    } else {
                        isOpen = nowMins >= openMins && nowMins <= closeMins;
                    }

                    if (!isOpen) {
                        res.status(403).json({ success: false, message: `La tienda opera de ${todaySchedule.apertura} a ${todaySchedule.cierre}. Vuelva en ese horario.` });
                        return;
                    }
                }
            }
        }
        // -----------------------

        const payload = {
            id: user._id,
            email: user.email,
            name: user.username,
            vendedor: user.vendedor,
            permissions: effectivePermissions
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

        res.status(200).json({
            success: true,
            message: 'Ingreso Correcto',
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.username,
                vendedor: user.vendedor,
                permissions: effectivePermissions
            }
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const registerUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, username, password, permissions, vendedor } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            res.status(400).json({ success: false, message: 'El usuario ya existe' });
            return;
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            email,
            username,
            password: hashedPassword,
            permissions: permissions || {}, // Fallback to schema defaults if empty
            vendedor: vendedor || 0
        });

        await newUser.save();

        const users = await User.find({}, '-password'); // Return list of all users without passwords
        res.status(201).json({ success: true, message: 'Usuario registrado exitosamente', users });

    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
    try {
        const users = await User.find({}, '-password');
        res.status(200).json({ success: true, users });
    } catch (error) {
        console.error("Get Users Error:", error);
        res.status(500).json({ success: false, message: 'Error obteniendo usuarios' });
    }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        await User.findByIdAndDelete(id);
        const users = await User.find({}, '-password');
        res.status(200).json({ success: true, message: 'Usuario eliminado', users });
    } catch (error) {
        console.error("Delete User Error:", error);
        res.status(500).json({ success: false, message: 'Error eliminando usuario' });
    }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { email, username, permissions, vendedor } = req.body;

        const user = await User.findById(id);
        if (!user) {
            res.status(404).json({ success: false, message: 'Usuario no encontrado' });
            return;
        }

        user.email = email || user.email;
        user.username = username || user.username;
        if (vendedor !== undefined && vendedor !== null) {
            user.vendedor = vendedor;
        }
        if (permissions) {
            user.permissions = permissions;
        }

        // If they provided a new password, hash it
        if (req.body.password && req.body.password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(req.body.password, salt);
        }

        await user.save();
        const users = await User.find({}, '-password');
        res.status(200).json({ success: true, message: 'Usuario actualizado', users });
    } catch (error) {
        console.error("Update User Error:", error);
        res.status(500).json({ success: false, message: 'Error actualizando usuario' });
    }
};
