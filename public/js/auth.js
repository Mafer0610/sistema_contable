const API_BASE = '/api';

// Función para mostrar alertas
function showAlert(type, message) {
    const alert = document.getElementById('alert');
    if (!alert) return;
    
    alert.className = `alert ${type}`;
    alert.textContent = message;
    alert.style.display = 'block';
    
    setTimeout(() => {
        alert.style.display = 'none';
    }, 5000);
}

// Función de login
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        
        if (!username || !password) {
            showAlert('error', 'Usuario y contraseña son obligatorios');
            return;
        }
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span class="icon">⏳</span> Iniciando sesión...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('user_data', JSON.stringify(data.user));
                
                showAlert('success', 'Sesión iniciada correctamente');
                
                setTimeout(() => {
                    window.location.href = '/panel';
                }, 1000);
            } else {
                showAlert('error', data.error || 'Error de autenticación');
            }
        } catch (error) {
            console.error('Error en login:', error);
            showAlert('error', 'Error de conexión con el servidor');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

// Verificar si ya está logueado al cargar la página de login
document.addEventListener('DOMContentLoaded', function() {
    const token = localStorage.getItem('auth_token');
    const currentPath = window.location.pathname;
    
    // Si está en la página de login y tiene token válido, redirigir al panel
    if (token && (currentPath === '/' || currentPath === '/index.html')) {
        fetch(`${API_BASE}/auth/verify`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            if (response.ok) {
                window.location.href = '/panel';
            } else {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user_data');
            }
        })
        .catch(error => {
            console.error('Error verificando token:', error);
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_data');
        });
    }
});