const API_BASE = '/api';
let cuentas = [];

// Verificar autenticación al cargar
document.addEventListener('DOMContentLoaded', async function() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        window.location.href = '/';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error('Token inválido');
        }

        const userData = JSON.parse(localStorage.getItem('user_data'));
        document.getElementById('username').textContent = userData.username;

        await cargarCuentas();
        agregarLineaMovimiento();
        setFechaActual();
    } catch (error) {
        console.error('Error de autenticación:', error);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
        window.location.href = '/';
    }
});

// Función para hacer peticiones con autenticación
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('auth_token');
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
        window.location.href = '/';
        throw new Error('Sesión expirada');
    }

    return response;
}

// Cerrar sesión
function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
    window.location.href = '/';
}

// Cargar catálogo de cuentas
async function cargarCuentas() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/cuentas`);
        cuentas = await response.json();
    } catch (error) {
        console.error('Error al cargar cuentas:', error);
        alert('Error al cargar el catálogo de cuentas');
    }
}

// Navegación entre secciones
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(sectionId).classList.add('active');
    event.target.classList.add('active');

    // Cargar datos según la sección
    if (sectionId === 'diario') cargarLibroDiario();
    if (sectionId === 'mayor') cargarLibroMayor();
    if (sectionId === 'balanza') cargarBalanza();
    if (sectionId === 'balance') cargarBalanceGeneral();
    if (sectionId === 'resultados') cargarEstadoResultados();
}

// Establecer fecha actual
function setFechaActual() {
    const fecha = new Date().toISOString().split('T')[0];
    document.getElementById('fecha').value = fecha;
}

// Agregar línea de movimiento
function agregarLineaMovimiento() {
    const container = document.getElementById('movimientosList');
    const linea = document.createElement('div');
    linea.className = 'movimiento-linea';
    
    linea.innerHTML = `
        <select class="cuenta-select" required>
            <option value="">Selecciona una cuenta...</option>
            ${cuentas.map(c => `<option value="${c.id}">${c.codigo} - ${c.nombre}</option>`).join('')}
        </select>
        <input type="number" class="debe-input" placeholder="Debe" step="0.01" min="0" value="0">
        <input type="number" class="haber-input" placeholder="Haber" step="0.01" min="0" value="0">
        <button type="button" class="btn-remove" onclick="eliminarLinea(this)">✖</button>
    `;
    
    container.appendChild(linea);
    
    // Agregar listeners para calcular totales
    linea.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', calcularTotales);
    });
}

// Eliminar línea de movimiento
function eliminarLinea(button) {
    const container = document.getElementById('movimientosList');
    if (container.children.length > 1) {
        button.parentElement.remove();
        calcularTotales();
    } else {
        alert('Debe haber al menos una línea de movimiento');
    }
}

// Calcular totales
function calcularTotales() {
    const lineas = document.querySelectorAll('.movimiento-linea');
    let totalDebe = 0;
    let totalHaber = 0;

    lineas.forEach(linea => {
        const debe = parseFloat(linea.querySelector('.debe-input').value) || 0;
        const haber = parseFloat(linea.querySelector('.haber-input').value) || 0;
        totalDebe += debe;
        totalHaber += haber;
    });

    document.getElementById('totalDebe').textContent = `${totalDebe.toFixed(2)}`;
    document.getElementById('totalHaber').textContent = `${totalHaber.toFixed(2)}`;
    
    const diferencia = Math.abs(totalDebe - totalHaber);
    document.getElementById('diferencia').textContent = `${diferencia.toFixed(2)}`;
    document.getElementById('diferencia').style.color = diferencia < 0.01 ? '#4caf50' : '#f44336';
}

// Guardar asiento
document.getElementById('movimientoForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const fecha = document.getElementById('fecha').value;
    const concepto = document.getElementById('concepto').value;
    const lineas = document.querySelectorAll('.movimiento-linea');
    
    const movimientos = [];
    let valid = true;

    lineas.forEach(linea => {
        const cuentaId = linea.querySelector('.cuenta-select').value;
        const debe = parseFloat(linea.querySelector('.debe-input').value) || 0;
        const haber = parseFloat(linea.querySelector('.haber-input').value) || 0;

        if (!cuentaId) {
            valid = false;
            return;
        }

        if (debe > 0 || haber > 0) {
            movimientos.push({ cuenta_id: cuentaId, debe, haber });
        }
    });

    if (!valid) {
        alert('Por favor selecciona todas las cuentas');
        return;
    }

    if (movimientos.length === 0) {
        alert('Debes agregar al menos un movimiento con monto');
        return;
    }

    const totalDebe = movimientos.reduce((sum, m) => sum + m.debe, 0);
    const totalHaber = movimientos.reduce((sum, m) => sum + m.haber, 0);

    if (Math.abs(totalDebe - totalHaber) > 0.01) {
        alert('El debe y el haber deben ser iguales');
        return;
    }

    try {
        const response = await fetchWithAuth(`${API_BASE}/asientos`, {
            method: 'POST',
            body: JSON.stringify({ fecha, concepto, movimientos })
        });

        if (response.ok) {
            alert('Asiento guardado exitosamente');
            document.getElementById('movimientoForm').reset();
            document.getElementById('movimientosList').innerHTML = '';
            agregarLineaMovimiento();
            setFechaActual();
        } else {
            const error = await response.json();
            alert(`Error: ${error.error}`);
        }
    } catch (error) {
        console.error('Error al guardar asiento:', error);
        alert('Error al guardar el asiento');
    }
});

// Cargar Libro Diario
async function cargarLibroDiario() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/asientos`);
        const asientos = await response.json();
        
        const tbody = document.querySelector('#tablaDiario tbody');
        tbody.innerHTML = '';

        asientos.forEach(asiento => {
            const fecha = new Date(asiento.fecha).toLocaleDateString('es-MX');
            
            const rowConcepto = tbody.insertRow();
            rowConcepto.innerHTML = `
                <td colspan="5" style="background: #f8f9fa; font-weight: bold; padding: 10px;">
                    ${fecha} - ${asiento.concepto} (Asiento #${asiento.numero_asiento})
                </td>
            `;

            asiento.movimientos.forEach(mov => {
                const row = tbody.insertRow();
                row.innerHTML = `
                    <td></td>
                    <td></td>
                    <td>${mov.cuenta}</td>
                    <td class="text-right">${mov.debe > 0 ? `${mov.debe.toFixed(2)}` : ''}</td>
                    <td class="text-right">${mov.haber > 0 ? `${mov.haber.toFixed(2)}` : ''}</td>
                `;
            });

            const rowSeparador = tbody.insertRow();
            rowSeparador.innerHTML = `<td colspan="5" style="height: 10px;"></td>`;
        });

        if (asientos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay asientos registrados</td></tr>';
        }
    } catch (error) {
        console.error('Error al cargar libro diario:', error);
        alert('Error al cargar el libro diario');
    }
}

// Cargar Libro Mayor
async function cargarLibroMayor() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/libro-mayor`);
        const libroMayor = await response.json();
        
        const container = document.getElementById('libroMayorContent');
        container.innerHTML = '';

        libroMayor.forEach(cuenta => {
            const cuentaDiv = document.createElement('div');
            cuentaDiv.className = 'cuenta-mayor';
            
            let htmlMovimientos = '';
            cuenta.movimientos.forEach(mov => {
                const fecha = new Date(mov.fecha).toLocaleDateString('es-MX');
                htmlMovimientos += `
                    <tr>
                        <td>${fecha}</td>
                        <td>${mov.concepto}</td>
                        <td class="text-right">${mov.debe > 0 ? `${mov.debe.toFixed(2)}` : ''}</td>
                        <td class="text-right">${mov.haber > 0 ? `${mov.haber.toFixed(2)}` : ''}</td>
                        <td class="text-right">${mov.saldo.toFixed(2)}</td>
                    </tr>
                `;
            });

            cuentaDiv.innerHTML = `
                <div class="cuenta-mayor-header">
                    ${cuenta.codigo} - ${cuenta.cuenta}
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Concepto</th>
                            <th>Debe</th>
                            <th>Haber</th>
                            <th>Saldo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${htmlMovimientos}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right"><strong>Saldo Final:</strong></td>
                            <td class="text-right"><strong>${cuenta.saldoFinal.toFixed(2)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            `;
            
            container.appendChild(cuentaDiv);
        });

        if (libroMayor.length === 0) {
            container.innerHTML = '<p class="text-center">No hay movimientos registrados</p>';
        }
    } catch (error) {
        console.error('Error al cargar libro mayor:', error);
        alert('Error al cargar el libro mayor');
    }
}

// Cargar Balanza de Comprobación
async function cargarBalanza() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/balanza`);
        const balanza = await response.json();
        
        const tbody = document.getElementById('balanzaBody');
        const tfoot = document.getElementById('balanzaFooter');
        tbody.innerHTML = '';

        let totales = {
            debe: 0,
            haber: 0,
            deudor: 0,
            acreedor: 0
        };

        balanza.forEach(cuenta => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${cuenta.nombre}</td>
                <td class="text-right">${cuenta.movimientos.debe.toFixed(2)}</td>
                <td class="text-right">${cuenta.movimientos.haber.toFixed(2)}</td>
                <td class="text-right">${cuenta.saldos.deudor > 0 ? `${cuenta.saldos.deudor.toFixed(2)}` : ''}</td>
                <td class="text-right">${cuenta.saldos.acreedor > 0 ? `${cuenta.saldos.acreedor.toFixed(2)}` : ''}</td>
            `;

            totales.debe += cuenta.movimientos.debe;
            totales.haber += cuenta.movimientos.haber;
            totales.deudor += cuenta.saldos.deudor;
            totales.acreedor += cuenta.saldos.acreedor;
        });

        tfoot.innerHTML = `
            <tr>
                <td><strong>SUMA IGUALES</strong></td>
                <td class="text-right"><strong>${totales.debe.toFixed(2)}</strong></td>
                <td class="text-right"><strong>${totales.haber.toFixed(2)}</strong></td>
                <td class="text-right"><strong>${totales.deudor.toFixed(2)}</strong></td>
                <td class="text-right"><strong>${totales.acreedor.toFixed(2)}</strong></td>
            </tr>
        `;

        if (balanza.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay movimientos registrados</td></tr>';
            tfoot.innerHTML = '';
        }
    } catch (error) {
        console.error('Error al cargar balanza:', error);
        alert('Error al cargar la balanza de comprobación');
    }
}

// Cargar Balance General
async function cargarBalanceGeneral() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/balance-general`);
        const balance = await response.json();
        
        const activoContent = document.getElementById('activoContent');
        activoContent.innerHTML = '';

        if (balance.activo.circulante.length > 0) {
            const circulanteDiv = document.createElement('div');
            circulanteDiv.className = 'balance-seccion';
            circulanteDiv.innerHTML = '<h4>Circulante</h4>';
            
            let totalCirculante = 0;
            balance.activo.circulante.forEach(cuenta => {
                if (cuenta.saldo > 0) {
                    const item = document.createElement('div');
                    item.className = 'balance-item';
                    item.innerHTML = `
                        <span>${cuenta.nombre}</span>
                        <span>${cuenta.saldo.toFixed(2)}</span>
                    `;
                    circulanteDiv.appendChild(item);
                    totalCirculante += cuenta.saldo;
                }
            });

            const totalDiv = document.createElement('div');
            totalDiv.className = 'balance-total';
            totalDiv.innerHTML = `
                <span>Total Activo Circulante</span>
                <span>${totalCirculante.toFixed(2)}</span>
            `;
            circulanteDiv.appendChild(totalDiv);
            activoContent.appendChild(circulanteDiv);
        }

        if (balance.activo.no_circulante.length > 0) {
            const noCirculanteDiv = document.createElement('div');
            noCirculanteDiv.className = 'balance-seccion';
            noCirculanteDiv.innerHTML = '<h4>No Circulante</h4>';
            
            let totalNoCirculante = 0;
            balance.activo.no_circulante.forEach(cuenta => {
                if (cuenta.saldo !== 0) {
                    const item = document.createElement('div');
                    item.className = 'balance-item';
                    item.innerHTML = `
                        <span>${cuenta.nombre}</span>
                        <span>${cuenta.saldo.toFixed(2)}</span>
                    `;
                    noCirculanteDiv.appendChild(item);
                    totalNoCirculante += cuenta.saldo;
                }
            });

            const totalDiv = document.createElement('div');
            totalDiv.className = 'balance-total';
            totalDiv.innerHTML = `
                <span>Total Activo No Circulante</span>
                <span>${totalNoCirculante.toFixed(2)}</span>
            `;
            noCirculanteDiv.appendChild(totalDiv);
            activoContent.appendChild(noCirculanteDiv);
        }

        const totalActivoDiv = document.createElement('div');
        totalActivoDiv.className = 'resultado-total';
        const totalActivo = balance.activo.circulante.reduce((sum, c) => sum + c.saldo, 0) +
                           balance.activo.no_circulante.reduce((sum, c) => sum + c.saldo, 0);
        totalActivoDiv.innerHTML = `
            <span>TOTAL DE ACTIVO</span>
            <span>${totalActivo.toFixed(2)}</span>
        `;
        activoContent.appendChild(totalActivoDiv);

        const pasivoContent = document.getElementById('pasivoContent');
        pasivoContent.innerHTML = '';

        if (balance.pasivo.corto_plazo.length > 0) {
            const cortoPlazoDiv = document.createElement('div');
            cortoPlazoDiv.className = 'balance-seccion';
            cortoPlazoDiv.innerHTML = '<h4>Corto Plazo</h4>';
            
            let totalCortoPlazo = 0;
            balance.pasivo.corto_plazo.forEach(cuenta => {
                if (cuenta.saldo > 0) {
                    const item = document.createElement('div');
                    item.className = 'balance-item';
                    item.innerHTML = `
                        <span>${cuenta.nombre}</span>
                        <span>${cuenta.saldo.toFixed(2)}</span>
                    `;
                    cortoPlazoDiv.appendChild(item);
                    totalCortoPlazo += cuenta.saldo;
                }
            });

            const totalDiv = document.createElement('div');
            totalDiv.className = 'balance-total';
            totalDiv.innerHTML = `
                <span>Total de Pasivo</span>
                <span>${totalCortoPlazo.toFixed(2)}</span>
            `;
            cortoPlazoDiv.appendChild(totalDiv);
            pasivoContent.appendChild(cortoPlazoDiv);
        }

        const capitalContent = document.getElementById('capitalContent');
        capitalContent.innerHTML = '';

        if (balance.capital.length > 0) {
            const capitalDiv = document.createElement('div');
            capitalDiv.className = 'balance-seccion';
            
            let totalCapital = 0;
            balance.capital.forEach(cuenta => {
                if (cuenta.saldo > 0) {
                    const item = document.createElement('div');
                    item.className = 'balance-item';
                    item.innerHTML = `
                        <span>${cuenta.nombre}</span>
                        <span>${cuenta.saldo.toFixed(2)}</span>
                    `;
                    capitalDiv.appendChild(item);
                    totalCapital += cuenta.saldo;
                }
            });

            const totalDiv = document.createElement('div');
            totalDiv.className = 'balance-total';
            totalDiv.innerHTML = `
                <span>Total de Capital Contable</span>
                <span>${totalCapital.toFixed(2)}</span>
            `;
            capitalDiv.appendChild(totalDiv);
            capitalContent.appendChild(capitalDiv);
        }

        const totalPasivoCapital = balance.pasivo.corto_plazo.reduce((sum, c) => sum + c.saldo, 0) +
                                   balance.capital.reduce((sum, c) => sum + c.saldo, 0);
        const totalPCDiv = document.createElement('div');
        totalPCDiv.className = 'resultado-total';
        totalPCDiv.innerHTML = `
            <span>PASIVO + CAPITAL</span>
            <span>${totalPasivoCapital.toFixed(2)}</span>
        `;
        capitalContent.appendChild(totalPCDiv);

    } catch (error) {
        console.error('Error al cargar balance general:', error);
        alert('Error al cargar el balance general');
    }
}

// Cargar Estado de Resultados
async function cargarEstadoResultados() {
    try {
        const response = await fetchWithAuth(`${API_BASE}/estado-resultados`);
        const estado = await response.json();
        
        const container = document.getElementById('estadoResultadosContent');
        container.innerHTML = '';

        const ventasDiv = document.createElement('div');
        ventasDiv.className = 'resultado-seccion';
        ventasDiv.innerHTML = '<h3>Ventas</h3>';
        
        let totalVentas = 0;
        estado.ingresos.forEach(cuenta => {
            if (cuenta.monto > 0) {
                const item = document.createElement('div');
                item.className = 'resultado-item';
                item.innerHTML = `
                    <span>${cuenta.nombre}</span>
                    <span>${cuenta.monto.toFixed(2)}</span>
                `;
                ventasDiv.appendChild(item);
                
                if (cuenta.nombre.includes('Devoluciones') || cuenta.nombre.includes('Rebajas') || cuenta.nombre.includes('Descuentos')) {
                    totalVentas -= cuenta.monto;
                } else {
                    totalVentas += cuenta.monto;
                }
            }
        });

        const ventasNetasDiv = document.createElement('div');
        ventasNetasDiv.className = 'resultado-subtotal';
        ventasNetasDiv.innerHTML = `
            <span>Ventas Netas</span>
            <span>${totalVentas.toFixed(2)}</span>
        `;
        ventasDiv.appendChild(ventasNetasDiv);
        container.appendChild(ventasDiv);

        if (estado.costo_ventas.length > 0) {
            const costoDiv = document.createElement('div');
            costoDiv.className = 'resultado-seccion';
            costoDiv.innerHTML = '<h3>Costo de Ventas</h3>';
            
            let totalCosto = 0;
            estado.costo_ventas.forEach(cuenta => {
                if (cuenta.monto > 0) {
                    const item = document.createElement('div');
                    item.className = 'resultado-item';
                    item.innerHTML = `
                        <span>${cuenta.nombre}</span>
                        <span>${cuenta.monto.toFixed(2)}</span>
                    `;
                    costoDiv.appendChild(item);
                    totalCosto += cuenta.monto;
                }
            });

            const costoTotalDiv = document.createElement('div');
            costoTotalDiv.className = 'resultado-subtotal';
            costoTotalDiv.innerHTML = `
                <span>Total Costo de Ventas</span>
                <span>${totalCosto.toFixed(2)}</span>
            `;
            costoDiv.appendChild(costoTotalDiv);
            container.appendChild(costoDiv);

            const utilidadBruta = totalVentas - totalCosto;
            const utilidadBrutaDiv = document.createElement('div');
            utilidadBrutaDiv.className = 'resultado-subtotal';
            utilidadBrutaDiv.style.background = '#e3f2fd';
            utilidadBrutaDiv.innerHTML = `
                <span>Utilidad Bruta</span>
                <span>${utilidadBruta.toFixed(2)}</span>
            `;
            container.appendChild(utilidadBrutaDiv);
        }

        if (estado.gastos.length > 0) {
            const gastosDiv = document.createElement('div');
            gastosDiv.className = 'resultado-seccion';
            gastosDiv.innerHTML = '<h3>Gastos de Operación</h3>';
            
            let totalGastos = 0;
            estado.gastos.forEach(cuenta => {
                if (cuenta.monto > 0) {
                    const item = document.createElement('div');
                    item.className = 'resultado-item';
                    item.innerHTML = `
                        <span>${cuenta.nombre}</span>
                        <span>${cuenta.monto.toFixed(2)}</span>
                    `;
                    gastosDiv.appendChild(item);
                    totalGastos += cuenta.monto;
                }
            });

            const gastosTotalDiv = document.createElement('div');
            gastosTotalDiv.className = 'resultado-subtotal';
            gastosTotalDiv.innerHTML = `
                <span>Total Gastos de Operación</span>
                <span>${totalGastos.toFixed(2)}</span>
            `;
            gastosDiv.appendChild(gastosTotalDiv);
            container.appendChild(gastosDiv);

            const costoTotal = estado.costo_ventas.reduce((sum, c) => sum + c.monto, 0);
            const utilidadNeta = totalVentas - costoTotal - totalGastos;
            const utilidadNetaDiv = document.createElement('div');
            utilidadNetaDiv.className = 'resultado-total';
            utilidadNetaDiv.innerHTML = `
                <span>Utilidad Neta del Ejercicio</span>
                <span>${utilidadNeta.toFixed(2)}</span>
            `;
            container.appendChild(utilidadNetaDiv);
        }

        if (estado.ingresos.length === 0 && estado.gastos.length === 0 && estado.costo_ventas.length === 0) {
            container.innerHTML = '<p class="text-center">No hay operaciones registradas</p>';
        }

    } catch (error) {
        console.error('Error al cargar estado de resultados:', error);
        alert('Error al cargar el estado de resultados');
    }
}