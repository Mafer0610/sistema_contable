const API_BASE = '/api';

// Función para mostrar alertas
function showAlert(type, message) {
    const alert = document.getElementById('alert');
    alert.className = `alert ${type}`;
    alert.textContent = message;
    alert.style.display = 'block';
    
    setTimeout(() => {
        alert.style.display = 'none';
    }, 5000);
}

// Función de registro
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        // Validaciones del cliente
        if (!username || !password || !confirmPassword) {
            showAlert('error', 'Todos los campos son obligatorios');
            return;
        }
        
        if (password.length < 6) {
            showAlert('error', 'La contraseña debe tener al menos 6 caracteres');
            return;
        }
        
        if (password !== confirmPassword) {
            showAlert('error', 'Las contraseñas no coinciden');
            return;
        }
        
        if (username.length < 3) {
            showAlert('error', 'El usuario debe tener al menos 3 caracteres');
            return;
        }
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '⏳ Registrando...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username,
                    password
                })
            });

            const data = await response.json();

            if (response.ok) {
                showAlert('success', 'Usuario registrado exitosamente');
                
                // Limpiar formulario
                document.getElementById('registerForm').reset();
                
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            } else {
                showAlert('error', data.error || 'Error en el registro');
            }
        } catch (error) {
            console.error('Error en registro:', error);
            showAlert('error', 'Error de conexión con el servidor');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

// Validación en tiempo real de las contraseñas
const confirmPasswordInput = document.getElementById('confirmPassword');
if (confirmPasswordInput) {
    confirmPasswordInput.addEventListener('input', function() {
        const password = document.getElementById('password').value;
        const confirmPassword = this.value;
        
        if (confirmPassword && password !== confirmPassword) {
            this.setCustomValidity('Las contraseñas no coinciden');
        } else {
            this.setCustomValidity('');
        }
    });
}

// Validación en tiempo real del usuario
const usernameInput = document.getElementById('username');
if (usernameInput) {
    usernameInput.addEventListener('input', function() {
        const username = this.value.trim();
        
        if (username && username.length < 3) {
            this.setCustomValidity('El usuario debe tener al menos 3 caracteres');
        } else if (username && !/^[a-zA-Z0-9_]+$/.test(username)) {
            this.setCustomValidity('El usuario solo puede contener letras, números y guiones bajos');
        } else {
            this.setCustomValidity('');
        }
    });
}