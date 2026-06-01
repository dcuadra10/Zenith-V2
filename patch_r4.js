const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al abrir la base de datos:', err.message);
        process.exit(1);
    }
});

const roleIdInput = process.argv[2];

if (!roleIdInput) {
    console.log('Uso: node patch_r4.js <ID_DEL_ROL_DE_R4>');
    console.log('Ejemplo: node patch_r4.js 1459455146311548993');
    db.close();
    process.exit(1);
}

const roleId = roleIdInput.replace(/[^0-9]/g, '');

db.serialize(() => {
    db.run(
        `UPDATE module_configs SET r4TrackingEnabled = 1, r4TrackingRole = ? WHERE guildId = '1431859727285092403'`,
        [`<@&${roleId}>`],
        function(err) {
            if (err) {
                console.error('Error al actualizar la base de datos:', err.message);
            } else {
                console.log('--------------------------------------------------');
                console.log('✅ Base de datos SQLite local actualizada con éxito.');
                console.log('👉 Módulo R4 Tracking: HABILITADO');
                console.log(`👉 Rol de R4 configurado: <@&${roleId}>`);
                console.log(`👉 Filas afectadas: ${this.changes}`);
                console.log('--------------------------------------------------');
                console.log('Por favor, reinicia el bot para que los cambios surtan efecto.');
            }
        }
    );
});

db.close();
