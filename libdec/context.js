/* 
 * Copyright (C) 2018 deroad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

module.exports = (function() {
    return function() {
        // macros
        this.macros = ['#include <stdint.h>'];
        this.addMacro = function(x) {
            if (this.macros.indexOf(x) < 0) {
                this.macros.push(x);
            }
        };
        this.printMacros = function() {
            var t = Global.printer.theme;
            for (var i = 0; i < this.macros.length; i++) {
                console.log(this.identfy() + t.macro(this.macros[i]));
            }
            console.log(this.identfy() + ' ');
        }

        // macros
        this.dependencies = [];
        this.addDependency = function(x) {
            if (this.dependencies.indexOf(x) < 0) {
                this.dependencies.push(x);
            }
        };
        this.printDependencies = function() {
            this.dependencies.forEach(function(x) {
                x.print();
            });
            if (this.dependencies.length > 0) {
                console.log(this.identfy() + ' ');
            }
        }

        // ident for print
        this.identAsm = '';
        this.identAsmSet = function(size) {
            // size = 0x + addr + space + asm + space
            size += 10;
            while (this.identAsm.length < size) {
                this.identAsm += '    ';
            }
        };
        this.ident = '';
        this.identIn = function() {
            this.ident += '    ';
        };
        this.identOut = function(force) {
            this.ident = this.ident.substr(4, this.ident.length);
        };
        this.identfy = function(s, p, noident) {
            var h = Global.printer.html;
            var ident = noident ? '' : h(this.ident);
            if (Global.evars.honor.assembly) {
                p = p || '';
                s = s || 0;
                return h('    ') + p + this.identAsm.substring(s, this.identAsm.length) + h(' | ') + ident
            }
            return ident;
        };

        // stack for instructions..
        this.scope = [];
        this.stack = [];
        this.local = function() {
            var n = this.scope[this.scope.length - 1];
            return this.stack.slice(this.stack.length - n, this.stack.length);
        };
        this.pushLocal = function() {
            this.scope.push(0);
        };
        this.popLocal = function() {
            var n = this.scope.pop();
            if (n > 0) {
                this.stack.splice(this.stack.length - n, n);
            }
        };
        this.push = function(x) {
            if (this.scope.length < 1) {
                throw new Error("Bad context stack (push with zero)")
            }
            this.scope[this.scope.length - 1]++;
            this.stack.push(x);
        };
        this.pop = function() {
            if (this.scope.length < 1 || this.scope[this.scope.length - 1] == 0) {
                throw new Error("Bad context stack (pop with zero)")
            }
            this.scope[this.scope.length - 1]--;
            return this.stack.pop();
        };
    };
})();