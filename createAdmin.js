require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function createAdminUser() {
    console.log('🔧 Creando usuario administrador...\n');

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('✅ Conexión a la base de datos exitosa');

        await connection.query('DELETE FROM usuarios WHERE username = ?', ['admin']);
        console.log('🗑️  Usuario admin anterior eliminado');

        const hashedPassword = await bcrypt.hash('123', 10);
        console.log('🔐 Contraseña hasheada:', hashedPassword);

        const [result] = await connection.query(
            'INSERT INTO usuarios (username, password) VALUES (?, ?)',
            ['admin', hashedPassword]
        );

        console.log('✅ Usuario admin creado exitosamente');
        console.log('\n📋 Credenciales:');
        console.log('   Usuario: admin');
        console.log('   Contraseña: 123');
        console.log(`   ID: ${result.insertId}\n`);

        const [users] = await connection.query(
            'SELECT id, username, LEFT(password, 20) as password_preview FROM usuarios WHERE username = ?',
            ['admin']
        );

        console.log('✅ Verificación:', users[0]);

        await connection.end();
        console.log('\n✅ Listo! Ahora puedes iniciar sesión.');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

createAdminUser();