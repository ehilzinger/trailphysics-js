import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The .d.ts files are written by hand. This keeps each one declaring
// exactly what its module exports at runtime: a name added to a module and
// not to its declarations, or declared and never exported, fails here.
var MODULES = ['earth', 'geometry', 'elevation', 'rider-physics', 'foot-pace', 'sun'];

function declared(name){
  var src = readFileSync(new URL('../' + name + '.d.ts', import.meta.url), 'utf8');
  var names = new Set();
  src.replace(/^export (?:const|function) ([A-Za-z_$][\w$]*)/gm, function(_, n){ names.add(n); });
  // Value re-exports (`export { X } from`), not `export type { … }`.
  src.replace(/^export \{([^}]*)\} from/gm, function(_, list){
    list.split(',').forEach(function(n){ if(n.trim()) names.add(n.trim()); });
  });
  return [...names].sort();
}

describe('type declarations', () => {
  MODULES.forEach(function(name){
    it(name + '.d.ts declares exactly what ' + name + '.js exports', async () => {
      var mod = await import('../' + name + '.js');
      expect(declared(name)).toEqual(Object.keys(mod).sort());
    });
  });

  it('the package entry exports every module', async () => {
    var index = await import('../index.js');
    var all = new Set();
    for(var name of MODULES) Object.keys(await import('../' + name + '.js')).forEach((k) => all.add(k));
    expect(Object.keys(index).sort()).toEqual([...all].sort());
  });
});
