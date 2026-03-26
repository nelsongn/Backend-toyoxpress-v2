/**
 * Script de prueba Brevo HTTP API
 * Ejecutar: npx tsx scripts/test-brevo-api.ts [email_destinatario]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.SMTP_FROM || 'contacto@toyoxpress.com';
const TO_EMAIL = 'mamedina770@gmail.com';

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
    console.log(`1️⃣  Enviando email de prueba via Brevo SDK...`);
    
    const SibApiV3Sdk = require('sib-api-v3-sdk');
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const auth = defaultClient.authentications['api-key'];
    auth.apiKey = API_KEY;

    const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    Object.assign(sendSmtpEmail, {
        sender: { name: 'ToyoXpress Test', email: FROM_EMAIL },
        to: [{ email: TO_EMAIL }],
        subject: '🚀 Test Brevo SDK — ' + new Date().toLocaleString(),
        htmlContent: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #0d6efd;">✅ Conexión SDK OK</h2>
                <p>Este es un email de prueba enviado mediante el <strong>SDK Oficial de Brevo</strong> (sib-api-v3-sdk).</p>
                <p>Si recibes esto, la configuración de la API Key es correcta y el SDK está funcionando.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #666;">Enviado el ${new Date().toLocaleString()} (ToyoXpress Engine V2)</p>
            </div>
        `
    });

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log('   ✅ Email enviado exitosamente!');
        console.log('   SDK Response:', JSON.stringify(data));
    } catch (err: any) {
        console.error('   ❌ Error del SDK Brevo:', err.response?.text || err.message);
        console.log('\n💡 Tip: Verifica que la API Key sea de tipo "v3" y esté activa en Brevo.');
    }
}

run();
