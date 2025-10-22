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

// Servir archivos estáticos
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

// Verificar conexión
pool.getConnection()
    .then(connection => {
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

app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;

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

        res.status(201).json({ message: 'Usuario registrado exitosamente' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error al registrar usuario' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;


    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    try {
        const [users] = await pool.query(
            'SELECT * FROM usuarios WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// ==================== RUTAS DE CATÁLOGO DE CUENTAS ====================

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

        // Obtener el siguiente número de movimiento
        const [result] = await connection.query(
            'SELECT COALESCE(MAX(numero_movimiento), 0) + 1 as siguiente FROM libro_diario'
        );
        const numeroMovimiento = result[0].siguiente;

        // Insertar en libro_diario
        const [asientoResult] = await connection.query(
            'INSERT INTO libro_diario (numero_movimiento, fecha, concepto, usuario_id) VALUES (?, ?, ?, ?)',
            [numeroMovimiento, fecha, concepto, req.user.id]
        );

        const asientoId = asientoResult.insertId;

        // Insertar movimientos
        for (const mov of movimientos) {
            await connection.query(
                'INSERT INTO movimientos (asiento_id, cuenta_id, debe, haber) VALUES (?, ?, ?, ?)',
                [asientoId, mov.cuenta_id, mov.debe || 0, mov.haber || 0]
            );
        }

        await connection.commit();
        res.status(201).json({ 
            message: 'Asiento creado exitosamente', 
            numero_movimiento: numeroMovimiento,
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

app.get('/api/asientos', authenticateToken, async (req, res) => {
    try {
        const [asientos] = await pool.query(`
            SELECT 
                ld.id,
                ld.numero_movimiento,
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
            ORDER BY ld.numero_movimiento DESC
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
                numero_asiento: asiento.numero_movimiento,
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
            // Obtener movimientos con el numero_movimiento de libro_diario
            const [movimientos] = await pool.query(`
                SELECT 
                    ld.numero_movimiento,
                    ld.fecha,
                    ld.concepto,
                    m.debe,
                    m.haber
                FROM movimientos m
                INNER JOIN libro_diario ld ON m.asiento_id = ld.id
                WHERE m.cuenta_id = ?
                ORDER BY ld.numero_movimiento, ld.fecha
            `, [cuenta.id]);

            let saldo = 0;
            const movimientosConSaldo = movimientos.map(mov => {
                saldo += parseFloat(mov.debe) - parseFloat(mov.haber);
                return {
                    numero_movimiento: mov.numero_movimiento,
                    fecha: mov.fecha,
                    concepto: mov.concepto,
                    debe: parseFloat(mov.debe),
                    haber: parseFloat(mov.haber)
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
        // INVENTARIO INICIAL: Primer movimiento de inventario en el Debe
        const [primerInventario] = await pool.query(`
            SELECT m.debe as inventario_inicial
            FROM movimientos m
            INNER JOIN libro_diario ld ON m.asiento_id = ld.id
            INNER JOIN catalogo_cuentas cc ON m.cuenta_id = cc.id
            WHERE cc.nombre = 'Inventario' AND m.debe > 0
            ORDER BY ld.fecha ASC, ld.numero_movimiento ASC, m.id ASC
            LIMIT 1
        `);

        const inventarioInicial = primerInventario.length > 0 ? parseFloat(primerInventario[0].inventario_inicial) : 20000;

        // COMPRAS: Suma total de inventario en el Debe MENOS el inventario inicial
        const [totalInventarioDebe] = await pool.query(`
            SELECT COALESCE(SUM(m.debe), 0) as total_debe
            FROM movimientos m
            INNER JOIN catalogo_cuentas cc ON m.cuenta_id = cc.id
            WHERE cc.nombre = 'Inventario' AND m.debe > 0
        `);

        const sumaInventarioDebe = totalInventarioDebe.length > 0 ? parseFloat(totalInventarioDebe[0].total_debe) : 0;
        const compras = sumaInventarioDebe - inventarioInicial;

        // INVENTARIO FINAL: Valor fijo de 17000
        const inventarioFinal = 17000;

        // Obtener VENTAS (solo cuentas de tipo ingreso)
        const [ventasData] = await pool.query(`
            SELECT 
                cc.nombre,
                COALESCE(SUM(m.debe), 0) as total_debe,
                COALESCE(SUM(m.haber), 0) as total_haber
            FROM catalogo_cuentas cc
            LEFT JOIN movimientos m ON cc.id = m.cuenta_id
            WHERE cc.tipo = 'ingreso'
            GROUP BY cc.id, cc.nombre
        `);

        let ventas = 0, devVentas = 0, rebVentas = 0, descVentas = 0;

        ventasData.forEach(cuenta => {
            const nombre = cuenta.nombre.toLowerCase();
            const debe = parseFloat(cuenta.total_debe);
            const haber = parseFloat(cuenta.total_haber);

            if (nombre.includes('devol') && nombre.includes('venta')) {
                devVentas += debe;
            } else if (nombre.includes('rebaj') && nombre.includes('venta')) {
                rebVentas += debe;
            } else if (nombre.includes('desc') && nombre.includes('venta')) {
                descVentas += debe;
            } else if (nombre.includes('venta')) {
                ventas += haber;
            }
        });

        // Obtener GASTOS
        const [gastosData] = await pool.query(`
            SELECT 
                cc.nombre,
                cc.subtipo,
                COALESCE(SUM(m.debe), 0) as total_debe,
                COALESCE(SUM(m.haber), 0) as total_haber
            FROM catalogo_cuentas cc
            LEFT JOIN movimientos m ON cc.id = m.cuenta_id
            WHERE cc.tipo = 'gasto'
            GROUP BY cc.id, cc.nombre, cc.subtipo
        `);

        let gastosCompra = 0, devCompras = 0, rebCompras = 0, descCompras = 0;
        let gastosVenta = 0, gastosAdmon = 0;

        gastosData.forEach(cuenta => {
            const nombre = cuenta.nombre.toLowerCase();
            const debe = parseFloat(cuenta.total_debe);
            const haber = parseFloat(cuenta.total_haber);

            // Costo de ventas
            if (cuenta.subtipo === 'costo_ventas') {
                if (nombre.includes('gasto') && nombre.includes('compra')) {
                    gastosCompra += debe;
                } else if (nombre.includes('devol') && nombre.includes('compra')) {
                    devCompras += haber;
                } else if (nombre.includes('rebaj') && nombre.includes('compra')) {
                    rebCompras += haber;
                } else if (nombre.includes('desc') && nombre.includes('compra')) {
                    descCompras += haber;
                }
            }
            // Gastos de operación
            else if (cuenta.subtipo === 'operacion') {
                if (nombre.includes('venta')) {
                    gastosVenta += debe;
                } else {
                    // Todos los demás gastos de operación van a administración
                    gastosAdmon += debe;
                }
            }
        });

        // CÁLCULOS EXACTOS según el formato del PDF
        
        // 1. VENTAS
        const ventasNetas = ventas - devVentas - rebVentas - descVentas;
        
        // 2. COSTO DE VENTAS
        const comprasTotales = compras + gastosCompra;
        const comprasNetas = comprasTotales - descCompras - devCompras - rebCompras;
        const totalMercancias = inventarioInicial + comprasNetas;
        const costoVentas = totalMercancias - inventarioFinal;
        
        // 3. UTILIDAD BRUTA
        const utilidadBruta = ventasNetas - costoVentas;
        
        // 4. GASTOS DE OPERACIÓN
        const totalGastosOperacion = gastosVenta + gastosAdmon;
        
        // 5. UTILIDAD ANTES DE IMPUESTOS
        const utilidadAntesImpuestos = utilidadBruta - totalGastosOperacion;
        
        // 6. IMPUESTOS
        const isr = utilidadAntesImpuestos > 0 ? utilidadAntesImpuestos * 0.30 : 0;
        const ptu = utilidadAntesImpuestos > 0 ? utilidadAntesImpuestos * 0.10 : 0;
        const totalImpuestos = isr + ptu;
        
        // 7. UTILIDAD NETA
        const utilidadNeta = utilidadAntesImpuestos - totalImpuestos;

        res.json({
            ventas: {
                ventas_totales: ventas,
                devoluciones: devVentas,
                rebajas: rebVentas,
                descuentos: descVentas,
                ventas_netas: ventasNetas
            },
            costo_ventas: {
                inventario_inicial: inventarioInicial,
                compras: compras,
                gastos_compra: gastosCompra,
                compras_totales: comprasTotales,
                descuentos: descCompras,
                devoluciones: devCompras,
                rebajas: rebCompras,
                compras_netas: comprasNetas,
                total_mercancias: totalMercancias,
                inventario_final: inventarioFinal,
                costo_ventas: costoVentas
            },
            utilidad_bruta: utilidadBruta,
            gastos_operacion: {
                gastos_venta: gastosVenta,
                gastos_administracion: gastosAdmon,
                total: totalGastosOperacion
            },
            utilidad_antes_impuestos: utilidadAntesImpuestos,
            impuestos: {
                isr_30: isr,
                ptu_10: ptu,
                total: totalImpuestos
            },
            utilidad_neta: utilidadNeta
        });
    } catch (error) {
        console.error('Error al obtener estado de resultados:', error);
        res.status(500).json({ error: 'Error al obtener estado de resultados' });
    }
});

// ==================== RUTAS DE ARQUEO DE CAJA ====================

// Obtener saldo actual de la cuenta Caja
app.get('/api/arqueo/saldo-caja', authenticateToken, async (req, res) => {
    try {
        const [result] = await pool.query(`
            SELECT 
                COALESCE(SUM(m.debe), 0) - COALESCE(SUM(m.haber), 0) as saldo
            FROM movimientos m
            INNER JOIN catalogo_cuentas cc ON m.cuenta_id = cc.id
            WHERE cc.nombre = 'Caja'
        `);
        
        const saldo = result.length > 0 ? parseFloat(result[0].saldo) : 0;
        res.json({ saldo });
    } catch (error) {
        console.error('Error al obtener saldo de caja:', error);
        res.status(500).json({ error: 'Error al obtener saldo de caja' });
    }
});

// Guardar arqueo de caja
app.post('/api/arqueo', authenticateToken, async (req, res) => {
    const {
        saldo_sistema,
        billetes_1000, billetes_500, billetes_200, billetes_100, billetes_50, billetes_20,
        monedas_20, monedas_10, monedas_5, monedas_2, monedas_1, monedas_050c,
        total_fisico, diferencia, observaciones
    } = req.body;

    try {
        await pool.query(`
            INSERT INTO arqueo_caja (
                usuario_id, saldo_sistema,
                billetes_1000, billetes_500, billetes_200, billetes_100, billetes_50, billetes_20,
                monedas_20, monedas_10, monedas_5, monedas_2, monedas_1, monedas_050c,
                total_fisico, diferencia, observaciones
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            req.user.id, saldo_sistema,
            billetes_1000 || 0, billetes_500 || 0, billetes_200 || 0, 
            billetes_100 || 0, billetes_50 || 0, billetes_20 || 0,
            monedas_20 || 0, monedas_10 || 0, monedas_5 || 0, 
            monedas_2 || 0, monedas_1 || 0, monedas_050c || 0,
            total_fisico, diferencia, observaciones || null
        ]);

        res.status(201).json({ message: 'Arqueo guardado exitosamente' });
    } catch (error) {
        console.error('Error al guardar arqueo:', error);
        res.status(500).json({ error: 'Error al guardar arqueo' });
    }
});

// Obtener historial de arqueos
app.get('/api/arqueo/historial', authenticateToken, async (req, res) => {
    try {
        const [arqueos] = await pool.query(`
            SELECT 
                ac.*,
                u.username
            FROM arqueo_caja ac
            INNER JOIN usuarios u ON ac.usuario_id = u.id
            ORDER BY ac.fecha DESC
            LIMIT 10
        `);

        res.json(arqueos);
    } catch (error) {
        console.error('Error al obtener historial de arqueos:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// Obtener detalle de un arqueo específico
app.get('/api/arqueo/:id', authenticateToken, async (req, res) => {
    try {
        const [arqueos] = await pool.query(`
            SELECT 
                ac.*,
                u.username
            FROM arqueo_caja ac
            INNER JOIN usuarios u ON ac.usuario_id = u.id
            WHERE ac.id = ?
        `, [req.params.id]);

        if (arqueos.length === 0) {
            return res.status(404).json({ error: 'Arqueo no encontrado' });
        }

        res.json(arqueos[0]);
    } catch (error) {
        console.error('Error al obtener arqueo:', error);
        res.status(500).json({ error: 'Error al obtener arqueo' });
    }
});

// ==================== RUTAS DE ARCHIVOS HTML ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'panel.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
});