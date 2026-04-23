import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    username: string;
    password?: string;
    vendedor?: number;
    permissions: {
        verMovimientos: boolean;
        verOtrosMovimientos: boolean;
        aprobarMovimientos: boolean;
        editarMovimientos: boolean;
        eliminarMovimientos: boolean;
        modificarFechas: boolean;
        crearUsuarios: boolean;
        modificarUsuarios: boolean;
        eliminarUsuarios: boolean;
        horasIngreso: boolean;
        obviarIngreso: boolean;
        configurarCuentas: boolean;
        consultarPrecios: boolean;
        verClientes: boolean;
        verExcel: boolean;
        verPedidos: boolean;
        [key: string]: boolean;
    };
}

const UserSchema: Schema = new Schema({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    vendedor: { type: Number, default: 0 },
    permissions: {
        verMovimientos: { type: Boolean, default: false },
        verOtrosMovimientos: { type: Boolean, default: false },
        aprobarMovimientos: { type: Boolean, default: false },
        editarMovimientos: { type: Boolean, default: false },
        eliminarMovimientos: { type: Boolean, default: false },
        modificarFechas: { type: Boolean, default: false },
        crearUsuarios: { type: Boolean, default: false },
        modificarUsuarios: { type: Boolean, default: false },
        eliminarUsuarios: { type: Boolean, default: false },
        horasIngreso: { type: Boolean, default: false },
        obviarIngreso: { type: Boolean, default: false },
        configurarCuentas: { type: Boolean, default: false },
        consultarPrecios: { type: Boolean, default: false },
        verClientes: { type: Boolean, default: false },
        verExcel: { type: Boolean, default: false },
        cargarProductos: { type: Boolean, default: false },
        verPedidos: { type: Boolean, default: false },
    }
}, {
    timestamps: true
});

export default mongoose.model<IUser>('User', UserSchema);
