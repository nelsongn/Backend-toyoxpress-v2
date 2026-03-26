/**
 * Script de prueba Brevo HTTP API
 * Ejecutar: npx tsx scripts/test-brevo-api.ts [email_destinatario]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.SMTP_FROM || 'contacto@toyoxpress.com';
const TO_EMAIL = process.argv[2] || process.env.SMTP_USER || 'pedidostoyoxpress@gmail.com';

console.log('\n🚀 TEST BREVO HTTP API');
console.log('─────────────────────────────────────────');
console.log(`  API Key:   ${API_KEY ? '✅ definida (' + API_KEY.slice(0, 8) + '...)' : '❌ VACÍA'}`);
console.log(`  From:      ${FROM_EMAIL}`);
console.log(`  To:        ${TO_EMAIL}`);
console.log('─────────────────────────────────────────\n');

if (!API_KEY) {
    console.error('❌ Error: BREVO_API_KEY no está definida en el .env');
    console.log('Asegúrate de agregar BREVO_API_KEY=tu_api_key en el archivo .env');
    process.exit(1);
}

async function run() {
    console.log(`1️⃣  Enviando email de prueba via API HTTP...`);
    
    const body = {
        sender: { name: 'ToyoXpress Test', email: FROM_EMAIL },
        to: [{ email: TO_EMAIL }],
        subject: '🚀 Test Brevo API — ' + new Date().toLocaleString(),
        htmlContent: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #0d6efd;">✅ Conexión HTTP OK</h2>
                <p>Este es un email de prueba enviado mediante la <strong>API REST de Brevo</strong> (Puerto 443).</p>
                <p>Si recibes esto, la configuración de la API Key es correcta y Railway no está bloqueando la salida.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #666;">Enviado el ${new Date().toLocaleString()} (ToyoXpress Engine V2)</p>
            </div>
        `
    };

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (response.ok) {
            console.log('   ✅ Email enviado exitosamente!');
            console.log('   Message ID:', data.messageId);
        } else {
            console.error('   ❌ Error de la API Brevo:', response.status);
            console.error('   Detalles:', JSON.stringify(data, null, 2));
            console.log('\n💡 Tip: Verifica que la API Key sea de tipo "v3" y esté activa en Brevo.');
        }
    } catch (err: any) {
        console.error('   ❌ Fallo crítico de red/petición:', err.message);
    }
}

run();
