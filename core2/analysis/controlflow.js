
module.exports = (function() {
	const Graph = require('core2/analysis/graph');
    const Expr = require('core2/analysis/ir/expressions');
    const Stmt = require('core2/analysis/ir/statements');
    const Simplify = require('core2/analysis/ir/simplify');

    function ControlFlow(func) {
        this.func = func;
        this.cfg = this.func.cfg();
        this.dfs = new Graph.DFSpanningTree(this.cfg);
        this.dom = new Graph.DominatorTree(this.cfg);
    }

    ControlFlow.prototype.fallthroughs = function() {
        this.func.basic_blocks.forEach(function(bb) {
            // N --> M
            var n_block = bb;
            var m_block = ((n_block.fail && this.func.getBlock(n_block.fail))
                || (n_block.jump && this.func.getBlock(n_block.jump)));

            if (m_block) {
                n_block.container.set_fallthrough(m_block.container);
            }
        }, this);
    };

    // TODO: duplicated code from ssa.js
    // get a function basic block from a graph node
    var node_to_block = function(f, node) {
        return f.getBlock(node.key) || null;
    };

    var get_destination = function(terminator) {
        var dest = undefined;

        if (terminator instanceof Stmt.Branch) {
            dest = terminator.taken.value;
        } else if (terminator instanceof Stmt.Goto) {
            dest = terminator.dest.value;
        }

        return dest;
    };

    // <DEBUG>
    var ArrayToString = function(a, opt) {
        return '[' + a.map(function(d) {
            return d.toString(opt);
        }).join(', ') + ']';
    };

    var ObjAddrToString = function(o, opt) {
        return o ? o.address.toString(opt) : o;
    };

    // </DEBUG>

    ControlFlow.prototype.construct_loop = function(node) {
        // head of the loop
        var head = this.dom.getNode(node);

        // the loop body consists of all the nodes that can reach back the
        // loop head. to know whether there is a path from some node S to another
        // node T, we need a DFS traveresal starting from S; if T is picked up
        // then there is a path. that is, a dedicated DFS traversal for each node
        // in the graph, or at least for all nodes that are dominated by the loop
        // head.
        //
        // to avoid that many DFS traversals, we just reverse the graph starting
        // from the loop head and perform a DFS traversal only once. all the nodes
        // that are picked up are known to be reached from loop head in the reversed
        // graph, which means the loop head is reached from each one of them in
        // the original one.
        //
        // note: that is normally done with a post-dominator tree, which features
        // a reversed dfs tree

        // build a reversed cfg starting from loop head; prune the edge
        // pointing the head immediate dominator, which is outside the loop
        var rcfg = this.cfg.reversed(node);
        rcfg.delEdge([node, head.idom.key]);

        // TODO: it looks like the idom trick won't work if there are multiple edges
        // coming into the loop head; do we need to split the edges to get a pre-loop?

        // build a dfs tree from the pruned reversed cfg; this would let us
        // know which nodes are in the loop body
        var rdfs = new Graph.DFSpanningTree(rcfg);
        var body = rdfs.iterNodes();

        // the set of nodes dominated by the loop head includes loop body nodes and
        // exit nodes. we now "xoring" those sets together to find exit nodes
        var exits = this.dom.all_dominated(head).filter(function(n) {
            var found = false;

            for (var i = 0; !found && (i < body.length); i++) {
                found = (n.key == body[i].key);
            }

            return !found;
        });

        // console.log('', 'loop:');
        // console.log('', '', 'head node :', head.toString(16));
        // console.log('', '', 'body nodes:', ArrayToString(body, 16));
        // console.log('', '', 'exit nodes:', ArrayToString(exits, 16));
    };

    ControlFlow.prototype.conditions = function() {
        //  for each node N in dfs tree:
        //      let C0 = container of node N
        //
        //      for each statement S in C0:
        //          if S is a branch:
        //              let I = new IF statament
        //              let Sf = Node S.fail
        //              let Sj = Node S.jump
        //
        //              if N dominates Sf and |predecessors(Sf)| = 1:
        //                  let C1 = container of Sf
        //                  attach C1 to I.then
        //                  pop Sf from domination list of N
        //
        //              if N dominates Sj and |predecessors(Sj)| = 1::
        //                  let C2 = container of Sj
        //                  attach C2 to I.else
        //                  pop Sj from domination list of N
        //
        //              replace S with I
        //              C0.next = container of last block left dominated by N, or null if nothing left

        var carried = null;

        this.dfs.iterNodes().forEach(function(N) {
            var C0 = node_to_block(this.func, N).container;
            var S = C0.terminator();
            var imm_dominated = this.dom.successors(this.dom.getNode(N.key));

            // console.log(ObjAddrToString(C0, 16), ':');
            // console.log('  domfront:', ArrayToString(this.dom.dominanceFrontier(N), 16));
            // console.log('  imm dom:', this.dom.getNode(N.key).idom ? this.dom.getNode(N.key).idom.toString(16) : 'none');
            // console.log('  +dominates:', ArrayToString(imm_dominated, 16));

            var dest = get_destination(S) || node_to_block(this.func, N).jump;

            // is this a back edge?
            if (dest && this.dom.dominates(this.dom.getNode(dest), this.dom.getNode(N.key))) {
                this.construct_loop(dest);
                
                S = null;
            }

            if (S instanceof Stmt.Branch) {
                var C1; // container for 'then' clause
                var C2; // container for 'else' clause
                var target;

                // <POLYFILL>
                imm_dominated.findIndex = function(predicate) {
                    for (var i = 0; i < this.length; i++) {
                        if (predicate(this[i])) {
                            return i;
                        }
                    }

                    return (-1);
                };
                // </POLYFILL>

                // block is immediately dominated by N
                var valid_if_block = function(address) {
                    var i = imm_dominated.findIndex(function(D) {
                        return D.key.eq(address);
                    });

                    return i === (-1) ? undefined : imm_dominated.splice(i, 1).pop();
                };

                // 'then' clause: should be immediately dominated by N
                target = S.not_taken.value;
                if (valid_if_block(target)) {
                    C1 = this.func.getBlock(target).container;
                    C1.prev = C0;
                }

                // 'else' clause: should be immediately dominates by N and have only one predecessor
                target = S.taken.value;
                if ((this.cfg.indegree(this.cfg.getNode(target)) === 1) && valid_if_block(target)) {
                    C2 = this.func.getBlock(target).container;
                    C2.prev = C0;
                }

                // TODO: do we have ssa at this point?
                var cond = S.cond.clone(['idx', 'def']);

                if (C1) {
                    cond = new Expr.BoolNot(cond);
                } else {
                    C1 = C2;
                    C2 = undefined;
                }

                S.replace(new Stmt.If(S.address, cond, C1, C2));
                Simplify.reduce_expr(cond);
                
                // console.log('  branch:', '[', ObjAddrToString(C1, 16), '|', ObjAddrToString(C2, 16), ']');
                // console.log('  -dominates:', ArrayToString(imm_dominated, 16));
            }

            else if (S instanceof Stmt.Goto) {
                var M = this.cfg.getNode(S.dest.value);

                if (M && this.cfg.predecessors(M).length > 1) {
                    // S.pluck();
                }
            }

            // condition sink should be the only node left on the domniation list.
            // if there is none, the sink is undefined
            var sink = imm_dominated[0];

            // in case there is no sink and we are carrying one from previous
            // branches, use it now
            if (!sink) {
                sink = carried;
                carried = null;
            }

            // in some rare cases there would be more than one item left on the
            // domination list, which means there is more than one sink. since we cannot
            // display more than one sink, we would need to carry it down the DFS road
            // and use it as a sink as soon as possible
            if (!carried) {
                carried = imm_dominated[1];
            }

            // console.log('  carried:', carried ? carried.toString(16) : carried);
            //
            // if (C0.fallthrough) {
            //     console.log('  -fthrough:', ObjAddrToString(C0.fallthrough, 16));
            // }

            // set fall-through container, if exists
            C0.set_fallthrough(sink && node_to_block(this.func, sink).container);

            // console.log('  +fthrough:', ObjAddrToString(C0.fallthrough, 16));
            // console.log();
        }, this);
    };

    return ControlFlow;
})();