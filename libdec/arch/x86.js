/* 
 * Copyright (C) 2017 deroad
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

    var Base = require('./base');

    var _signed_types = {
        'byte': 'int8_t ',
        'word': 'int16_t',
        'dword': 'int32_t',
        'qword': 'int64_t'
    };

    var _unsigned_types = {
        'byte': 'uint8_t ',
        'word': 'uint16_t',
        'dword': 'uint32_t',
        'qword': 'uint64_t'
    };

    var _bits_types = {
        'byte': 8,
        'word': 16,
        'dword': 32,
        'qword': 64
    };

    var _call_fix_name = function(name) {
        return name.replace(/\[reloc\.|\]/g, '').replace(/[\.:]/g, '_').replace(/__+/g, '_').replace(/_[0-9]+$/, '').replace(/^_+/, '');
    }

    var _common_math = function(e, op, bits) {
        if (e[1].match(/^[er]?[sb]p$/)) {
            return null;
        }
        if (e.length == 2) {
            if (e[1].match(/r\wx/)) {
                return op("rax", "rax", (bits ? '(uint' + bits + '_t) ' : '') + e[1]);
            } else if (e[1].match(/r\wx/)) {
                return op("edx:eax", "edx:eax", (bits ? '(uint' + bits + '_t) ' : '') + e[1]);
            }
            return op("dx:ax", "dx:ax", (bits ? '(uint' + bits + '_t) ' : '') + e[1]);
        } else if (_signed_types[e[1]]) {
            var a = "*((" + _signed_types[e[1]] + "*) " + e[2].replace(/\[|\]/g, '') + ")";
            return op(a, a, e[3]);
        } else if (_signed_types[e[2]]) {
            return op(e[1], e[1], "*((" + _signed_types[e[2]] + "*) " + e[3].replace(/\[|\]/g, '') + ")");
        }
        return op(e[1], e[1], (bits ? '(uint' + bits + '_t) ' : '') + e[2]);
    };

    var _memory_cmp = function(e, cond) {
        if (_signed_types[e[1]]) {
            cond.a = "*((" + _signed_types[e[1]] + "*) " + e[2].replace(/\[|\]/g, '') + ")";
            cond.b = e[3];
        } else if (_signed_types[e[2]]) {
            cond.a = e[1];
            cond.b = "*((" + _signed_types[e[2]] + "*) " + e[3].replace(/\[|\]/g, '') + ")";
        } else {
            cond.a = e[1];
            cond.b = e[2];
        }
    };

    var _conditional = function(instr, context, type) {
        instr.conditional(context.cond.a, context.cond.b, type);
        return null;
    };

    var _compare = function(instr, context) {
        var e = instr.parsed;
        if (e.length == 4) {
            _memory_cmp(e, context.cond);
            return null;
        }
        context.cond.a = e[1];
        context.cond.b = e[2];
        return null;
    };

    var _call_function = function(instr, context, instrs, is_pointer) {
        var regs32 = ['ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp'];
        var regs64 = ['rdi', 'rsi', 'rdx', 'r10', 'r8', 'r9'];
        var args = [];
        var bad_ax = true;
        var end = instrs.indexOf(instr) - regs64.length;
        for (var i = instrs.indexOf(instr) - 1; i >= end; i--) {
            var arg0 = instrs[i].parsed[1];
            if (_bits_types[arg0]) {
                arg0 = instrs[i].parsed[2];
            }
            if (bad_ax && (arg0 == 'eax' || arg0 == 'rax')) {
                bad_ax = false;
                continue;
            }
            if ((arg0 != 'esp' && regs32.indexOf(arg0) < 0 && regs64.indexOf(arg0) < 0) ||
                !instrs[i].pseudo || !instrs[i].pseudo[0] == 'call') {
                break;
            }
            bad_ax = false;
            if (regs32.indexOf(arg0) > -1) {
                regs32.splice(regs32.indexOf(arg0), 1);
            } else if (regs64.indexOf(arg0) > -1) {
                regs64.splice(regs64.indexOf(arg0), 1);
            }
            args.push(instrs[i].string || instrs[i].pseudo.toString().replace(/^.+\s=\s/, '').trim());
            instrs[i].valid = false;
        }
        if (_bits_types[instr.parsed[1]]) {
            var callname = instr.parsed[2];
            if (callname.indexOf("reloc.") == 0) {
                callname = callname.replace(/reloc\./g, '');
            } else {
                callname = "*((" + _unsigned_types[instr.parsed[1]] + "*) " + callname + ")";
            }
            return Base.call(_call_fix_name(callname), args, is_pointer || false)
        }
        return Base.call(_call_fix_name(instr.parsed[1]), args, is_pointer || false);
    }

    return {
        instructions: {
            add: function(instr) {
                return _common_math(instr.parsed, Base.add);
            },
            sub: function(instr) {
                return _common_math(instr.parsed, Base.subtract);
            },
            and: function(instr) {
                return _common_math(instr.parsed, Base.and);
            },
            or: function(instr) {
                return _common_math(instr.parsed, Base.or);
            },
            xor: function(instr, context, instructions) {
                if (instr.parsed[1] == instr.parsed[2]) {
                    var p = instructions[instructions.indexOf(instr) + 1];
                    if (p && p.pseudo == 'ret') {
                        context.leave = 'eax';
                    }
                    return Base.assign(instr.parsed[1], '0');
                }
                return _common_math(instr.parsed, Base.xor);
            },
            lea: function(instr) {
                return Base.assign(instr.parsed[1], instr.string || instr.parsed[2]);
            },
            call: _call_function,
            mov: function(instr) {
                if (instr.parsed[1].match(/^[er]?[sb]p$/)) {
                    return null;
                } else if (instr.parsed.length == 3) {
                    return Base.assign(instr.parsed[1], instr.string || instr.parsed[2]);
                } else if (_bits_types[instr.parsed[1]]) {
                    return Base.write_memory(instr.parsed[2], instr.parsed[3], _bits_types[instr.parsed[1]], true);
                }
                return Base.read_memory(instr.parsed[3], instr.parsed[1], _bits_types[instr.parsed[2]], true);
            },
            nop: function(instr, context, instructions) {
                var index = instructions.indexOf(instr);
                if (index == (instructions.length - 1) &&
                    instructions[index - 1].parsed[0] == 'call' &&
                    instructions[index - 1].pseudo.ctx.indexOf('return') != 0) {
                    instructions[index - 1].pseudo.ctx = 'return ' + instructions[index - 1].pseudo.ctx;
                }
                return Base.nop();
            },
            leave: function(instr, context) {
                context.leave = 'eax';
                return Base.nop();
            },
            jmp: function(instr, context, instructions) {
                var e = instr.parsed;
                if (e.length == 3 && e[2].indexOf("[reloc.") == 0) {
                    return Base.call(_call_fix_name(e[2]));
                } else if (e.length == 2 && (e[1] == 'eax' || e[1] == 'rax')) {
                    return _call_function(instr, context, instructions, true);
                }
                return Base.nop();
            },
            cmp: _compare,
            test: function(instr, context, instructions) {
                var e = instr.parsed;
                context.cond.a = (e[1] == e[2]) ? e[1] : "(" + e[1] + " & " + e[2] + ")";
                context.cond.b = '0';
                return Base.nop();
            },
            ret: function(instr, context) {
                return Base.return(context.leave || '');
            },
            push: function() {
                return Base.nop();
            },
            pop: function(instr, context, instructions) {
                if (instr.parsed[1] == 'rbp' && instructions[instructions.indexOf(instr) - 1].parsed[1] == 'eax') {
                    context.leave = 'eax';
                }
                return Base.nop();
            },
            jne: function(i, c) {
                _conditional(i, c, 'EQ');
                return Base.nop();
            },
            je: function(i, c) {
                _conditional(i, c, 'NE');
                return Base.nop();
            },
            ja: function(i, c) {
                _conditional(i, c, 'LE');
                return Base.nop();
            },
            jae: function(i, c) {
                _conditional(i, c, 'LT');
                return Base.nop();
            },
            jb: function(i, c) {
                _conditional(i, c, 'GE');
                return Base.nop();
            },
            jbe: function(i, c) {
                _conditional(i, c, 'GT');
                return Base.nop();
            },
            jg: function(i, c) {
                _conditional(i, c, 'LE');
                return Base.nop();
            },
            jge: function(i, c) {
                _conditional(i, c, 'LT');
                return Base.nop();
            },
            jle: function(i, c) {
                _conditional(i, c, 'GT');
                return Base.nop();
            },
            jl: function(i, c) {
                _conditional(i, c, 'GE');
                return Base.nop();
            },
            js: function(i, c) {
                _conditional(i, c, 'LT');
                return Base.nop();
            },
            jns: function(i, c) {
                _conditional(i, c, 'GE');
                return Base.nop();
            },
            invalid: function() {
                return Base.nop();
            }
        },
        parse: function(asm) {
            if (!asm) {
                return [];
            }
            var mem = '';
            if (asm.match(/\[.+\]/)) {
                mem = asm.match(/\[.+\]/)[0].replace(/\[|\]/g, '');
            }
            var ret = asm.replace(/\[.+\]/g, '{#}').replace(/,/g, ' ');
            ret = ret.replace(/\s+/g, ' ').trim().split(' ');
            return ret.map(function(a) {
                return a == '{#}' ? mem : a;
            });
        },
        context: function() {
            return {
                cond: {
                    a: null,
                    b: null
                },
                leave: null,
                vars: []
            }
        }
    };
})();