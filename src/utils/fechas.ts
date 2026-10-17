// Días calendario según la hora de Caracas. El servidor (Railway) corre en UTC, así que
// new Date().setHours(0, 0, 0, 0) da la medianoche UTC = 20:00 del día anterior en Caracas.

export const ZONA_CARACAS = "America/Caracas";

// Venezuela usa UTC-4 todo el año (no tiene horario de verano desde 2016).
const OFFSET_CARACAS = "-04:00";

/** Fecha "YYYY-MM-DD" del día en Caracas para el instante dado (por defecto, ahora). */
export function fechaCaracas(instante: Date = new Date()): string {
    // en-CA formatea como YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: ZONA_CARACAS,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(instante);
}

/** 00:00:00.000 hora de Caracas del día "YYYY-MM-DD". */
export function inicioDiaCaracas(fecha: string): Date {
    return new Date(`${fecha}T00:00:00.000${OFFSET_CARACAS}`);
}

/** 23:59:59.999 hora de Caracas del día "YYYY-MM-DD". */
export function finDiaCaracas(fecha: string): Date {
    return new Date(`${fecha}T23:59:59.999${OFFSET_CARACAS}`);
}
