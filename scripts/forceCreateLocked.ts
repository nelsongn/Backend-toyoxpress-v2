import "dotenv/config";
import mongoose from "mongoose";
import { Producto } from "../src/models/Producto";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";

const WooCommerce = new WooCommerceRestApi({
    url: process.env.WC_URL || "https://toyoxpress.com/",
    consumerKey: process.env.WC_CONSUMER_KEY,
    consumerSecret: process.env.WC_CONSUMER_SECRET,
    version: "wc/v3",
    queryStringAuth: true,
});

async function forceCreateLockedSkus() {
    await mongoose.connect(process.env.MONGO_DEV || "mongodb://127.0.0.1:27017/toyoxpress");

    const lockedSkus = [
        "11213-28021"
    ];

    console.log("SKUs detectados:", lockedSkus);

    const localProducts = await Producto.find({ "Código": { $in: lockedSkus } }).lean();

    console.log(`Intentando forzar la creación de ${localProducts.length} productos...`);

    const batchCreate = [];
    const createdIds: any[] = [];

    // Verificamos si los que dijeron "SKU no valido" es porque ya exiten (posiblemente borrados mal)
    // OJO: solo enviamos a crear a los que NO existen.

    for (const p of localProducts) {
        const originalSku = p["Código"];

        try {
            // Revisamos en papelera
            let existingId = null;

            const resPub = await WooCommerce.get("products", { sku: originalSku });
            if (resPub.data && resPub.data.length > 0) existingId = resPub.data[0].id;

            if (!existingId) {
                const resAny = await WooCommerce.get("products", { sku: originalSku, status: "trash" });
                if (resAny.data && resAny.data.length > 0) existingId = resAny.data[0].id;
            }

            if (existingId) {
                console.log(`✅ OMITIENDO: ${originalSku} YA EXISTE EN LA BASE DE WOOCOMMERCE CON ID ${existingId}`);
                continue; // No hace falta forzar la creación
            }
        } catch (e) { }

        // Si llegó aquí es porque el API _literalmente_ dice que no existe, pero al crear tira "ya se esta procesando"
        // o "SKU Invalido" sin resource ID. Lo forzamos con TEMP-

        const skuHack = `TEMP-${originalSku}`;
        const priceMin = p["Precio Minimo"] || 0;
        const priceMax = p["Precio Mayor"] || 0;

        batchCreate.push({
            name: p["Nombre"],
            sku: skuHack,
            price: String(priceMin),
            regular_price: String(priceMin),
            manage_stock: true,
            status: "publish",
            stock_quantity: Number(p["Existencia Actual"]),
            attributes: [
                {
                    id: 1,
                    name: "Marca",
                    position: 0,
                    visible: true,
                    variation: false,
                    options: p["Modelo"] ? [p["Modelo"]] : [],
                },
            ],
            categories: [],
            meta_data: [
                { key: "cliente 2 price", value: String(priceMax) },
                {
                    key: "festiUserRolePrices",
                    value: `{"cliente2":"${priceMax}","salePrice":{"cliente2":""},"schedule":{"cliente2":{"date_from":"","date_to":""}}}`,
                },
            ]
        });
    }

    try {
        if (batchCreate.length > 0) {
            console.log(`Enviando ${batchCreate.length} hacks temporales a WooCommerce...`);
            const res = await WooCommerce.post("products/batch", { create: batchCreate });
            res.data.create.forEach((r: any, idx: number) => {
                if (r.error) {
                    console.error(`Fallo forzando ${batchCreate[idx].sku}: ${r.error.message}`);
                } else {
                    console.log(`✅ Creado exitosamente con Hack: ID ${r.id} -> ${r.sku}`);
                    const origSku = batchCreate[idx].sku.replace("TEMP-", "");
                    createdIds.push({ id: r.id, originalSku: origSku });
                }
            });
        }

        if (createdIds.length > 0) {
            console.log("\nFase 2: Restaurando los SKUs originales sin espacio (actualizando por ID)...");
            const batchUpdate = createdIds.map(item => ({
                id: item.id,
                sku: item.originalSku
            }));
            const fixRes = await WooCommerce.post("products/batch", { update: batchUpdate });
            fixRes.data.update.forEach((r: any) => {
                if (r.error) console.error(`Fallo restaurando SKU para ID ${r.id}:`, r.error);
                else console.log(`🔄 Restaurado a la normalidad: ID ${r.id} -> ${r.sku}`);
            });
        }
    } catch (e: any) {
        console.error("Error fatal:", e.response?.data || e);
    }
    process.exit(0);
}

forceCreateLockedSkus();
