import { Request, Response } from 'express';
import { Cuenta } from '../models/Cuenta';
import { logger } from '../index';

export const getCuentas = async (req: Request, res: Response): Promise<void> => {
    try {
        // Filter out soft-deleted accounts
        const cuentas = await Cuenta.find({ disabled: { $ne: true } }).sort({ label: 1 });
        res.status(200).json({ success: true, count: cuentas.length, cuentas });
    } catch (error: any) {
        logger.error('Error fetching cuentas', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

export const createCuenta = async (req: Request, res: Response): Promise<void> => {
    try {
        const { label, color, saldo } = req.body;

        if (!label || label.trim() === '') {
            res.status(400).json({ success: false, message: 'El nombre de la cuenta es requerido' });
            return;
        }

        // Check if account already exists
        const existingCuenta = await Cuenta.findOne({ label: label.trim(), disabled: { $ne: true } });
        if (existingCuenta) {
            res.status(403).json({ success: false, message: 'Esta cuenta ya existe' });
            return;
        }

        const newCuenta = new Cuenta({
            value: label.trim(),
            label: label.trim(),
            color: color || '#000000',
            saldo: saldo || false
        });

        await newCuenta.save();

        res.status(201).json({ success: true, message: 'Cuenta creada exitosamente', cuenta: newCuenta });
    } catch (error: any) {
        logger.error('Error creating cuenta', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al crear' });
    }
};

export const updateCuenta = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { label, color, saldo } = req.body;

        const cuenta = await Cuenta.findById(id);

        if (!cuenta || cuenta.disabled) {
            res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
            return;
        }

        if (label) {
            // Check if another account has the same name
            const duplicate = await Cuenta.findOne({ label: label.trim(), _id: { $ne: id }, disabled: { $ne: true } });
            if (duplicate) {
                res.status(403).json({ success: false, message: 'El nuevo nombre ya pertenece a otra cuenta' });
                return;
            }
            cuenta.label = label.trim();
            cuenta.value = label.trim(); // keep sync
        }

        if (color) cuenta.color = color;
        if (typeof saldo === 'boolean') cuenta.saldo = saldo;

        await cuenta.save();

        res.status(200).json({ success: true, message: 'Cuenta actualizada', cuenta });
    } catch (error: any) {
        logger.error('Error updating cuenta', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar' });
    }
};

export const deleteCuenta = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        // Perform Soft Delete to preserve historical financial data
        const deletedCuenta = await Cuenta.findByIdAndUpdate(
            id,
            { disabled: true },
            { returnDocument: 'after' }
        );

        if (!deletedCuenta) {
            res.status(404).json({ success: false, message: 'Cuenta no encontrada' });
            return;
        }

        res.status(200).json({ success: true, message: 'Cuenta eliminada (Soft-Delete)' });
    } catch (error: any) {
        logger.error('Error deleting cuenta', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor al eliminar' });
    }
};
