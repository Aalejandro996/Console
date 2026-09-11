/* Script opcional para (re)crear el usuario maestro manualmente:
   node seed.js "nombre_usuario" "contraseña_en_texto_plano"
   Imprime el hash resultante para usarlo como MASTER_PASSWORD_HASH. */
const { hashPassword } = require('./auth');
const [,, username, password] = process.argv;
if (!username || !password) {
  console.log('Uso: node seed.js <usuario> <contraseña>');
  process.exit(1);
}
console.log('MASTER_USERNAME=' + username);
console.log('MASTER_PASSWORD_HASH=' + hashPassword(password));
