require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos con MIME types correctos
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Configuración de la base de datos
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Verificar conexión a la base de datos
pool.getConnection()
    .then(connection => {
        console.log('✅ Conexión a la base de datos exitosa');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Error al conectar a la base de datos:', err);
    });

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
};

// ==================== RUTAS DE AUTENTICACIÓN ====================

// Registro de usuario
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;

    console.log('Intento de registro:', username);

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    if (username.length < 3) {
        return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO usuarios (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );

        console.log('✅ Usuario registrado:', username);
        res.status(201).json({ message: 'Usuario registrado exitosamente' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    console.log('Intento de login:', username);

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    try {
        const [users] = await pool.query(
            'SELECT * FROM usuarios WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            console.log('❌ Usuario no encontrado:', username);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            console.log('❌ Contraseña incorrecta para:', username);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('✅ Login exitoso:', username);
        res.json({
            token,
            user: { id: user.id, username: user.username }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// Verificar token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// ==================== RUTAS DE CATÁLOGO DE CUENTAS ====================

// Obtener todas las cuentas
app.get('/api/cuentas', authenticateToken, async (req, res) => {
    try {
        const [cuentas] = await pool.query(
            'SELECT * FROM catalogo_cuentas WHERE activa = TRUE ORDER BY codigo'
        );
        res.json(cuentas);
    } catch (error) {
        console.error('Error al obtener cuentas:', error);
        res.status(500).json({ error: 'Error al obtener cuentas' });
    }
});

// ==================== RUTAS DE LIBRO DIARIO ====================

// Crear nuevo asiento
app.post('/api/asientos', authenticateToken, async (req, res) => {
    const { fecha, concepto, movimientos } = req.body;

    if (!fecha || !concepto || !movimientos || movimientos.length === 0) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    const totalDebe = movimientos.reduce((sum, m) => sum + parseFloat(m.debe || 0), 0);
    const totalHaber = movimientos.reduce((sum, m) => sum + parseFloat(m.haber || 0), 0);

    if (Math.abs(totalDebe - totalHaber) > 0.01) {
        return res.status(400).json({ error: 'El debe y el haber deben ser iguales' });
    }

    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            'SELECT COALESCE(MAX(numero_asiento), 0) + 1 as siguiente FROM libro_diario'
        );
        const numeroAsiento = result[0].siguiente;

        const [asientoResult] = await connection.query(
            'INSERT INTO libro_diario (numero_asiento, fecha, concepto, usuario_id) VALUES (?, ?, ?, ?)',
            [numeroAsiento, fecha, concepto, req.user.id]
        );

        const asientoId = asientoResult.insertId;

        for (const mov of movimientos) {
            await connection.query(
                'INSERT INTO movimientos (asiento_id, cuenta_id, debe, haber) VALUES (?, ?, ?, ?)',
                [asientoId, mov.cuenta_id, mov.debe || 0, mov.haber || 0]
            );
        }

        await connection.commit();
        res.status(201).json({ 
            message: 'Asiento creado exitosamente', 
            numero_asiento: numeroAsiento,
            id: asientoId
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error al crear asiento:', error);
        res.status(500).json({ error: 'Error al crear asiento' });
    } finally {
        connection.release();
    }
});

// Obtener todos los asientos (Libro Diario)
app.get('/api/asientos', authenticateToken, async (req, res) => {
    try {
        const [asientos] = await pool.query(`
            SELECT 
                ld.id,
                ld.numero_asiento,
                ld.fecha,
                ld.concepto,
                GROUP_CONCAT(
                    CONCAT(cc.nombre, '|', m.debe, '|', m.haber) 
                    ORDER BY m.id 
                    SEPARATOR ';;'
                ) as movimientos_data
            FROM libro_diario ld
            LEFT JOIN movimientos m ON ld.id = m.asiento_id
            LEFT JOIN catalogo_cuentas cc ON m.cuenta_id = cc.id
            GROUP BY ld.id
            ORDER BY ld.numero_asiento DESC
        `);

        const asientosFormateados = asientos.map(asiento => {
            const movimientos = [];
            if (asiento.movimientos_data) {
                asiento.movimientos_data.split(';;').forEach(mov => {
                    const [nombre, debe, haber] = mov.split('|');
                    movimientos.push({
                        cuenta: nombre,
                        debe: parseFloat(debe),
                        haber: parseFloat(haber)
                    });
                });
            }
            return {
                id: asiento.id,
                numero_asiento: asiento.numero_asiento,
                fecha: asiento.fecha,
                concepto: asiento.concepto,
                movimientos
            };
        });

        res.json(asientosFormateados);
    } catch (error) {
        console.error('Error al obtener asientos:', error);
        res.status(500).json({ error: 'Error al obtener asientos' });
    }
});

// ==================== RUTAS DE LIBRO MAYOR ====================

app.get('/api/libro-mayor', authenticateToken, async (req, res) => {
    try {
        const [cuentas] = await pool.query(`
            SELECT DISTINCT cc.id, cc.codigo, cc.nombre
            FROM catalogo_cuentas cc
            INNER JOIN movimientos m ON cc.id = m.cuenta_id
            ORDER BY cc.codigo
        `);

        const libroMayor = [];

        for (const cuenta of cuentas) {
            const [movimientos] = await pool.query(`
                SELECT 
                    ld.fecha,
                    ld.concepto,
                    m.debe,
                    m.haber
                FROM movimientos m
                INNER JOIN libro_diario ld ON m.asiento_id = ld.id
                WHERE m.cuenta_id = ?
                ORDER BY ld.fecha, ld.id
            `, [cuenta.id]);

            let saldo = 0;
            const movimientosConSaldo = movimientos.map(mov => {
                saldo += parseFloat(mov.debe) - parseFloat(mov.haber);
                return {
                    fecha: mov.fecha,
                    concepto: mov.concepto,
                    debe: parseFloat(mov.debe),
                    haber: parseFloat(mov.haber),
                    saldo: saldo
                };
            });

            libroMayor.push({
                cuenta: cuenta.nombre,
                codigo: cuenta.codigo,
                movimientos: movimientosConSaldo,
                saldoFinal: saldo
            });
        }

        res.json(libroMayor);
    } catch (error) {
        console.error('Error al obtener libro mayor:', error);
        res.status(500).json({ error: 'Error al obtener libro mayor' });
    }
});

// ==================== RUTAS DE BALANZA ====================

app.get('/api/balanza', authenticateToken, async (req, res) => {
    try {
        const [balanza] = await pool.query(`
            SELECT 
                cc.codigo,
                cc.nombre,
                cc.naturaleza,
                COALESCE(SUM(m.debe), 0) as total_debe,
                COALESCE(SUM(m.haber), 0) as total_haber
            FROM catalogo_cuentas cc
            LEFT JOIN movimientos m ON cc.id = m.cuenta_id
            WHERE cc.activa = TRUE
            GROUP BY cc.id, cc.codigo, cc.nombre, cc.naturaleza
            HAVING total_debe > 0 OR total_haber > 0
            ORDER BY cc.codigo
        `);

        const balanzaFormateada = balanza.map(cuenta => {
            const debe = parseFloat(cuenta.total_debe);
            const haber = parseFloat(cuenta.total_haber);
            const saldo = debe - haber;
            
            return {
                codigo: cuenta.codigo,
                nombre: cuenta.nombre,
                movimientos: {
                    debe: debe,
                    haber: haber
                },
                saldos: {
                    deudor: saldo > 0 ? saldo : 0,
                    acreedor: saldo < 0 ? Math.abs(saldo) : 0
                }
            };
        });

        res.json(balanzaFormateada);
    } catch (error) {
        console.error('Error al obtener balanza:', error);
        res.status(500).json({ error: 'Error al obtener balanza' });
    }
});

// ==================== BALANCE GENERAL ====================

app.get('/api/balance-general', authenticateToken, async (req, res) => {
    try {
        const [cuentas] = await pool.query(`
            SELECT 
                cc.codigo,
                cc.nombre,
                cc.tipo,
                cc.subtipo,
                cc.naturaleza,
                COALESCE(SUM(m.debe), 0) as total_debe,
                COALESCE(SUM(m.haber), 0) as total_haber
            FROM catalogo_cuentas cc
            LEFT JOIN movimientos m ON cc.id = m.cuenta_id
            WHERE cc.activa = TRUE AND cc.tipo IN ('activo', 'pasivo', 'capital')
            GROUP BY cc.id
            ORDER BY cc.codigo
        `);

        const balance = {
            activo: { circulante: [], no_circulante: [] },
            pasivo: { corto_plazo: [], largo_plazo: [] },
            capital: []
        };

        cuentas.forEach(cuenta => {
            const debe = parseFloat(cuenta.total_debe);
            const haber = parseFloat(cuenta.total_haber);
            let saldo = debe - haber;
            
            if (cuenta.naturaleza === 'acreedora') {
                saldo = -saldo;
            }

            const cuentaFormateada = {
                codigo: cuenta.codigo,
                nombre: cuenta.nombre,
                saldo: Math.abs(saldo)
            };

            if (cuenta.tipo === 'activo') {
                if (cuenta.subtipo === 'circulante') {
                    balance.activo.circulante.push(cuentaFormateada);
                } else {
                    balance.activo.no_circulante.push(cuentaFormateada);
                }
            } else if (cuenta.tipo === 'pasivo') {
                if (cuenta.subtipo === 'corto_plazo') {
                    balance.pasivo.corto_plazo.push(cuentaFormateada);
                } else {
                    balance.pasivo.largo_plazo.push(cuentaFormateada);
                }
            } else if (cuenta.tipo === 'capital') {
                balance.capital.push(cuentaFormateada);
            }
        });

        res.json(balance);
    } catch (error) {
        console.error('Error al obtener balance general:', error);
        res.status(500).json({ error: 'Error al obtener balance general' });
    }
});

// ==================== ESTADO DE RESULTADOS ====================

app.get('/api/estado-resultados', authenticateToken, async (req, res) => {
    try {
        const [cuentas] = await pool.query(`
            SELECT 
                cc.codigo,
                cc.nombre,
                cc.tipo,
                cc.subtipo,
                cc.naturaleza,
                COALESCE(SUM(m.debe), 0) as total_debe,
                COALESCE(SUM(m.haber), 0) as total_haber
            FROM catalogo_cuentas cc
            LEFT JOIN movimientos m ON cc.id = m.cuenta_id
            WHERE cc.activa = TRUE AND cc.tipo IN ('ingreso', 'gasto')
            GROUP BY cc.id
            ORDER BY cc.codigo
        `);

        const estado = {
            ingresos: [],
            gastos: [],
            costo_ventas: []
        };

        cuentas.forEach(cuenta => {
            const debe = parseFloat(cuenta.total_debe);
            const haber = parseFloat(cuenta.total_haber);
            let monto = 0;

            if (cuenta.tipo === 'ingreso') {
                monto = haber - debe;
            } else {
                monto = debe - haber;
            }

            const cuentaFormateada = {
                codigo: cuenta.codigo,
                nombre: cuenta.nombre,
                monto: Math.abs(monto)
            };

            if (cuenta.tipo === 'ingreso') {
                estado.ingresos.push(cuentaFormateada);
            } else if (cuenta.subtipo === 'costo_ventas') {
                estado.costo_ventas.push(cuentaFormateada);
            } else {
                estado.gastos.push(cuentaFormateada);
            }
        });

        res.json(estado);
    } catch (error) {
        console.error('Error al obtener estado de resultados:', error);
        res.status(500).json({ error: 'Error al obtener estado de resultados' });
    }
});

// ==================== RUTAS DE ARCHIVOS HTML ====================

// Ruta raíz - Login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Registro
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Panel (después de login)
app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'panel.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📁 Archivos estáticos en: ${path.join(__dirname, 'public')}`);
    console.log(`🔐 JWT Secret configurado: ${process.env.JWT_SECRET ? '✅' : '❌'}`);
});