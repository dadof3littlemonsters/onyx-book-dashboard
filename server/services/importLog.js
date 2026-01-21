const fs = require('fs');
const path = require('path');

class ImportLogService {
    constructor() {
        // Must match the path used in /app/scripts/process-download.js
        this.logFile = '/app/data/import_log.json';
    }

    getLog() {
        try {
            if (!fs.existsSync(this.logFile)) {
                return { imports: [] };
            }
            return JSON.parse(fs.readFileSync(this.logFile, 'utf8'));
        } catch (error) {
            console.error('Error reading import log:', error);
            return { imports: [] };
        }
    }

    getImports(limit = 50) {
        const log = this.getLog();
        return log.imports.slice(0, limit);
    }

    getImportById(id) {
        const log = this.getLog();
        return log.imports.find(imp => imp.id === id);
    }

    clearOldImports(daysToKeep = 30) {
        try {
            const log = this.getLog();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            log.imports = log.imports.filter(imp => {
                const importDate = new Date(imp.timestamp);
                return importDate > cutoffDate;
            });

            fs.writeFileSync(this.logFile, JSON.stringify(log, null, 2));
            return { success: true, message: `Cleared imports older than ${daysToKeep} days` };
        } catch (error) {
            console.error('Error clearing old imports:', error);
            return { success: false, message: error.message };
        }
    }

    getStats() {
        const log = this.getLog();
        const total = log.imports.length;
        const successful = log.imports.filter(i => i.status === 'success').length;
        const failed = log.imports.filter(i => i.status === 'failed' || i.status === 'partial').length;
        const mamImports = log.imports.filter(i => i.operation === 'hardlink').length;

        return {
            total,
            successful,
            failed,
            mamImports,
            successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : 0
        };
    }
}

module.exports = new ImportLogService();
