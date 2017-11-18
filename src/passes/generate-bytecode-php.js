/* 
 * ! This is modified version of file "pegjs/lib/compiler/passes/generate-bytecode.js"
 * to generate bytecode that would be php-compatible
 * Original copyright:
 * 
 * ------------------------------------------------------------------
 * Copyright (c) 2010-2013 David Majda
 * 
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 * 
 */

var js = require("pegjs/lib/compiler/js"),
    asts = require("pegjs/lib/compiler/asts"),
    visitor = require("pegjs/lib/compiler/visitor"),
    op    = require("pegjs/lib/compiler/opcodes"),
    internalUtils = require("../utils");

/* Generates bytecode.
 *
 * Instructions
 * ============
 *
 * Stack Manipulation
 * ------------------
 *
 *  [0] PUSH c
 *
 *        stack.push(consts[c]);
 *
 *  [1] PUSH_UNDEFINED
 *
 *        stack.push(undefined);
 *
 *  [2] PUSH_NULL
 *
 *        stack.push(null);
 *
 *  [3] PUSH_FAILED
 *
 *        stack.push(FAILED);
 *
 *  [4] PUSH_EMPTY_ARRAY
 *
 *        stack.push([]);
 *
 *  [5] PUSH_CURR_POS
 *
 *        stack.push(currPos);
 *
 *  [6] POP
 *
 *        stack.pop();
 *
 *  [7] POP_CURR_POS
 *
 *        currPos = stack.pop();
 *
 *  [8] POP_N n
 *
 *        stack.pop(n);
 *
 *  [9] NIP
 *
 *        value = stack.pop();
 *        stack.pop();
 *        stack.push(value);
 *
 * [10] APPEND
 *
 *        value = stack.pop();
 *        array = stack.pop();
 *        array.push(value);
 *        stack.push(array);
 *
 * [11] WRAP n
 *
 *        stack.push(stack.pop(n));
 *
 * [12] TEXT
 *
 *        stack.push(input.substring(stack.pop(), currPos));
 *
 * Conditions and Loops
 * --------------------
 *
 * [13] IF t, f
 *
 *        if (stack.top()) {
 *          interpret(ip + 3, ip + 3 + t);
 *        } else {
 *          interpret(ip + 3 + t, ip + 3 + t + f);
 *        }
 *
 * [14] IF_ERROR t, f
 *
 *        if (stack.top() === FAILED) {
 *          interpret(ip + 3, ip + 3 + t);
 *        } else {
 *          interpret(ip + 3 + t, ip + 3 + t + f);
 *        }
 *
 * [15] IF_NOT_ERROR t, f
 *
 *        if (stack.top() !== FAILED) {
 *          interpret(ip + 3, ip + 3 + t);
 *        } else {
 *          interpret(ip + 3 + t, ip + 3 + t + f);
 *        }
 *
 * [16] WHILE_NOT_ERROR b
 *
 *        while(stack.top() !== FAILED) {
 *          interpret(ip + 2, ip + 2 + b);
 *        }
 *
 * Matching
 * --------
 *
 * [17] MATCH_ANY a, f, ...
 *
 *        if (input.length > currPos) {
 *          interpret(ip + 3, ip + 3 + a);
 *        } else {
 *          interpret(ip + 3 + a, ip + 3 + a + f);
 *        }
 *
 * [18] MATCH_STRING s, a, f, ...
 *
 *        if (input.substr(currPos, consts[s].length) === consts[s]) {
 *          interpret(ip + 4, ip + 4 + a);
 *        } else {
 *          interpret(ip + 4 + a, ip + 4 + a + f);
 *        }
 *
 * [19] MATCH_STRING_IC s, a, f, ...
 *
 *        if (input.substr(currPos, consts[s].length).toLowerCase() === consts[s]) {
 *          interpret(ip + 4, ip + 4 + a);
 *        } else {
 *          interpret(ip + 4 + a, ip + 4 + a + f);
 *        }
 *
 * [20] MATCH_REGEXP r, a, f, ...
 *
 *        if (consts[r].test(input.charAt(currPos))) {
 *          interpret(ip + 4, ip + 4 + a);
 *        } else {
 *          interpret(ip + 4 + a, ip + 4 + a + f);
 *        }
 *
 * [21] ACCEPT_N n
 *
 *        stack.push(input.substring(currPos, n));
 *        currPos += n;
 *
 * [22] ACCEPT_STRING s
 *
 *        stack.push(consts[s]);
 *        currPos += consts[s].length;
 *
 * [23] FAIL e
 *
 *        stack.push(FAILED);
 *        fail(consts[e]);
 *
 * Calls
 * -----
 *
 * [24] LOAD_SAVED_POS p
 *
 *        savedPos = stack[p];
 *
 * [25] UPDATE_SAVED_POS
 *
 *        savedPos = currPos;
 *
 * [26] CALL f, n, pc, p1, p2, ..., pN
 *
 *        value = consts[f](stack[p1], ..., stack[pN]);
 *        stack.pop(n);
 *        stack.push(value);
 *
 * Rules
 * -----
 *
 * [27] RULE r
 *
 *        stack.push(parseRule(r));
 *
 * Failure Reporting
 * -----------------
 *
 * [28] SILENT_FAILS_ON
 *
 *        silentFails++;
 *
 * [29] SILENT_FAILS_OFF
 *
 *        silentFails--;
 */
module.exports = function(ast, options) {
  var mbstringAllowed = (
    typeof options.phpegjs.mbstringAllowed === 'undefined'
      ? true
      : options.phpegjs.mbstringAllowed
  );

  var consts = [];
  var functions = [];

  function addConst(value) {
    var index = consts.findIndex(function(c) { return c === value; });

    return index === -1 ? consts.push(value) - 1 : index;
  }

  function addFunctionConst(params, code) {
    var value = {
      params: '',
      code: internalUtils.extractPhpCode( code )
    };

    var first = true;
    for ( var i = 0; i < params.length; i++ ) {
      if ( ! first ) {
        value.params += ', ';
      }
      value.params += '$' + params[i];
      first = false;
    }

    var index = functions.findIndex(function( c ) {
      return c.params === value.params && c.code === value.code;
    } );

    return index === -1 ? functions.push(value) - 1 : index;
  }

  function cloneEnv(env) {
    let clone = {};

    Object.keys(env).forEach(name => {
      clone[name] = env[name];
    });

    return clone;
  }

  function buildSequence() {
    return Array.prototype.concat.apply([], arguments);
  }

  function buildCondition(condCode, thenCode, elseCode) {
    return condCode.concat(
      [thenCode.length, elseCode.length],
      thenCode,
      elseCode
    );
  }

  function buildLoop(condCode, bodyCode) {
    return condCode.concat([bodyCode.length], bodyCode);
  }

  function buildCall(functionIndex, delta, env, sp) {
    var params = Object.keys(env).map(function(name) { return sp - env[name]; });

    return [op.CALL, functionIndex, delta, params.length].concat(params);
  }

  function buildSimplePredicate(expression, negative, context) {
    return buildSequence(
      [op.PUSH_CURR_POS],
      [op.SILENT_FAILS_ON],
      generate(expression, {
        sp:     context.sp + 1,
        env:    cloneEnv(context.env),
        action: null
      }),
      [op.SILENT_FAILS_OFF],
      buildCondition(
        [negative ? op.IF_ERROR : op.IF_NOT_ERROR],
        buildSequence(
          [op.POP],
          [negative ? op.POP : op.POP_CURR_POS],
          [op.PUSH_NULL]
        ),
        buildSequence(
          [op.POP],
          [negative ? op.POP_CURR_POS : op.POP],
          [op.PUSH_FAILED]
        )
      )
    );
  }

  function buildSemanticPredicate(code, negative, context) {
    var functionIndex  = addFunctionConst(Object.keys(context.env), code);

    return buildSequence(
      [op.UPDATE_SAVED_POS],
      buildCall(functionIndex, 0, context.env, context.sp),
      buildCondition(
        [op.IF],
        buildSequence(
          [op.POP],
          negative ? [op.PUSH_FAILED] : [op.PUSH_NULL]
        ),
        buildSequence(
          [op.POP],
          negative ? [op.PUSH_NULL] : [op.PUSH_FAILED]
        )
      )
    );
  }

  function buildAppendLoop(expressionCode) {
    return buildLoop(
      [op.WHILE_NOT_ERROR],
      buildSequence([op.APPEND], expressionCode)
    );
  }

  var generate = visitor.build({
    grammar: function(node) {
      node.rules.forEach(generate);

      node.consts = consts;
      node.functions = functions;
    },

    rule: function(node) {
      node.bytecode = generate(node.expression, {
        sp:     -1,  // stack pointer
        env:    { }, // mapping of label names to stack positions
        action: null // action nodes pass themselves to children here
      });
    },

    named: function(node, context) {
      var nameIndex = addConst(
        'array("type" => "other", "description" => ' + internalUtils.quote(node.name) + ' )'
      );

      /*
       * The code generated below is slightly suboptimal because |FAIL| pushes
       * to the stack, so we need to stick a |POP| in front of it. We lack a
       * dedicated instruction that would just report the failure and not touch
       * the stack.
       */
      return buildSequence(
        [op.SILENT_FAILS_ON],
        generate(node.expression, context),
        [op.SILENT_FAILS_OFF],
        buildCondition([op.IF_ERROR], [op.FAIL, nameIndex], [])
      );
    },

    choice: function(node, context) {
      function buildAlternativesCode(alternatives, context) {
        return buildSequence(
          generate(alternatives[0], {
            sp:     context.sp,
            env:    cloneEnv(context.env),
            action: null
          }),
          alternatives.length > 1
            ? buildCondition(
                [op.IF_ERROR],
                buildSequence(
                  [op.POP],
                  buildAlternativesCode(alternatives.slice(1), context)
                ),
                []
              )
            : []
        );
      }

      return buildAlternativesCode(node.alternatives, context);
    },

    action: function(node, context) {
      var env            = cloneEnv(context.env),
          emitCall       = node.expression.type !== "sequence"
                        || node.expression.elements.length === 0,
          expressionCode = generate(node.expression, {
            sp:     context.sp + (emitCall ? 1 : 0),
            env:    env,
            action: node
          }),
          functionIndex  = addFunctionConst(Object.keys(env), node.code);
  
      return emitCall
        ? buildSequence(
            [op.PUSH_CURR_POS],
            expressionCode,
            buildCondition(
              [op.IF_NOT_ERROR],
              buildSequence(
                [op.LOAD_SAVED_POS, 1],
                buildCall(functionIndex, 1, env, context.sp + 2)
              ),
              []
            ),
            [op.NIP]
          )
        : expressionCode;
    },

    sequence: function(node, context) {
      function buildElementsCode(elements, context) {
        var processedCount, functionIndex;

        if (elements.length > 0) {
          processedCount = node.elements.length - elements.slice(1).length;

          return buildSequence(
            generate(elements[0], {
              sp:     context.sp,
              env:    context.env,
              action: null
            }),
            buildCondition(
              [op.IF_NOT_ERROR],
              buildElementsCode(elements.slice(1), {
                sp:     context.sp + 1,
                env:    context.env,
                action: context.action
              }),
              buildSequence(
                processedCount > 1 ? [op.POP_N, processedCount] : [op.POP],
                [op.POP_CURR_POS],
                [op.PUSH_FAILED]
              )
            )
          );
        } else {
          if (context.action) {
            functionIndex = addFunctionConst(
              Object.keys(context.env),
              context.action.code
            );

            return buildSequence(
              [op.LOAD_SAVED_POS, node.elements.length],
              buildCall(
                functionIndex,
                node.elements.length,
                context.env,
                context.sp
              ),
              [op.NIP]
            );
          } else {
            return buildSequence([op.WRAP, node.elements.length], [op.NIP]);
          }
        }
      }

      if (node.elements.length > 0) {
        return buildSequence(
          [op.PUSH_CURR_POS],
          buildElementsCode(node.elements, {
            sp:     context.sp + 1,
            env:    context.env,
            action: context.action
          })
        );
      } else {
        return [op.PUSH_EMPTY_ARRAY];
      }
    },

    labeled: function(node, context) {
      var env = cloneEnv(context.env);

      context.env[node.label] = context.sp + 1;

      return generate(node.expression, {
        sp:     context.sp,
        env:    env,
        action: null
      });
    },

    text: function(node, context) {
      return buildSequence(
        [op.PUSH_CURR_POS],
        generate(node.expression, {
          sp:     context.sp + 1,
          env:    cloneEnv(context.env),
          action: null
        }),
        buildCondition(
          [op.IF_NOT_ERROR],
          buildSequence([op.POP], [op.TEXT]),
          [op.NIP]
        )
      );
    },

    simple_and: function(node, context) {
      return buildSimplePredicate(node.expression, false, context);
    },

    simple_not: function(node, context) {
      return buildSimplePredicate(node.expression, true, context);
    },

    optional: function(node, context) {
      return buildSequence(
        generate(node.expression, {
          sp:     context.sp,
          env:    cloneEnv(context.env),
          action: null
        }),
        buildCondition(
          [op.IF_ERROR],
          buildSequence([op.POP], [op.PUSH_NULL]),
          []
        )
      );
    },

    zero_or_more: function(node, context) {
      var expressionCode  = generate(node.expression, {
            sp:     context.sp + 1,
            env:    cloneEnv(context.env),
            action: null
          });

      return buildSequence(
        [op.PUSH_EMPTY_ARRAY],
        expressionCode,
        buildAppendLoop(expressionCode),
        [op.POP]
      );
    },

    one_or_more: function(node, context) {
      var expressionCode  = generate(node.expression, {
            sp:     context.sp + 1,
            env:    cloneEnv(context.env),
            action: null
          });

      return buildSequence(
        [op.PUSH_EMPTY_ARRAY],
        expressionCode,
        buildCondition(
          [op.IF_NOT_ERROR],
          buildSequence(buildAppendLoop(expressionCode), [op.POP]),
          buildSequence([op.POP], [op.POP], [op.PUSH_FAILED])
        )
      );
    },

    group: function(node, context) {
      return generate(node.expression, {
        sp:     context.sp,
        env:    cloneEnv(context.env),
        action: null
      });
    },

    semantic_and: function(node, context) {
      return buildSemanticPredicate(node.code, false, context);
    },

    semantic_not: function(node, context) {
      return buildSemanticPredicate(node.code, true, context);
    },

    rule_ref: function(node) {
      return [op.RULE, asts.indexOfRule(ast, node.name)];
    },

    literal: function(node) {
      if (node.ignoreCase && !mbstringAllowed) {
        throw new Error(
          'Case-insensitive string matching requires the '
          + '`mbstring` PHP extension, but it is disabled '
          + 'via `mbstringAllowed: false`.'
        );
      }

      var stringIndex, expectedIndex;

      if (node.value.length > 0) {
        stringIndex = addConst(node.ignoreCase
          ? internalUtils.quote(node.value.toLowerCase())
          : internalUtils.quote(node.value)
        );
        expectedIndex = addConst([
          'array(',
          '"type" => "literal",',
          '"value" => ' + internalUtils.quote(node.value) + ',',
          '"description" => ' + internalUtils.quote(internalUtils.quote(node.value)),
          ')'
        ].join(' '));

        /*
         * For case-sensitive strings the value must match the beginning of the
         * remaining input exactly. As a result, we can use |ACCEPT_STRING| and
         * save one |substr| call that would be needed if we used |ACCEPT_N|.
         */
        return buildCondition(
          node.ignoreCase
            ? [op.MATCH_STRING_IC, stringIndex]
            : [op.MATCH_STRING, stringIndex],
          node.ignoreCase
            ? [op.ACCEPT_N, node.value.length]
            : [op.ACCEPT_STRING, stringIndex],
          [op.FAIL, expectedIndex]
        );
      } else {
        stringIndex = addConst('""');

        return [op.PUSH, stringIndex];
      }
    },

    "class": function(node) {
      if (node.ignoreCase && !mbstringAllowed) {
        throw new Error(
          'Case-insensitive character class matching requires the '
          + '`mbstring` PHP extension, but it is disabled '
          + 'via `mbstringAllowed: false`.'
        );
      }

      var regexp, regexpIndex, expectedIndex;

      function hex(ch) {
        return ch.charCodeAt(0).toString(16).toUpperCase();
      }

      function quoteForPhpRegexp(s) {
           return s
            .replace(/\\/g, '\\\\')  // backslash
            .replace(/\//g, '\\/')   // closing slash
            .replace(/\[/g, '\\[')   // opening ) bracket
            .replace(/\]/g, '\\]')   // closing ) bracket
            .replace(/\(/g, '\\(')   // opening ( bracket
            .replace(/\)/g, '\\)')   // closing ( bracket
            .replace(/\^/g, '\\^')   // caret
            .replace(/\$/g, '\\$')   // dollar
            .replace(/([^\[])-/g,  '$1\\-')   // dash
            .replace(/\0/g, '\\0')   // null
            .replace(/\t/g, '\\t')   // horizontal tab
            .replace(/\n/g, '\\n')   // line feed
            .replace(/\v/g, '\\x0B') // vertical tab
            .replace(/\f/g, '\\f')   // form feed
            .replace(/\r/g, '\\r')   // carriage return
            .replace(/[\x00-\x0f]/g,          function(ch) { return '\\x0' + hex(ch); })
            .replace(/[\x10-\x1f\x7f-\x9f]/g, function(ch) { return '\\x' + hex(ch); })
            .replace(/[\xFF-\uFFFF]/g, function(ch) {
                var hexCode = ch.charCodeAt(0).toString(16).toUpperCase();
                hexCode = Array(4 - hexCode.length + 1).join('0') + hexCode;
                return '\\x{' + hexCode + '}';
              });
      }

      function quotePhp(s) {
            return '"' + s
              .replace(/\\/g, '\\\\')  // backslash
              .replace(/"/g, '\\"')    // closing quote character
              .replace(/\x08/g, '\\b') // backspace
              .replace(/\t/g, '\\t')   // horizontal tab
              .replace(/\n/g, '\\n')   // line feed
              .replace(/\f/g, '\\f')   // form feed
              .replace(/\r/g, '\\r')   // carriage return
              .replace(/\$/g, '\\$')   // dollar
              .replace(/[\x00-\x0f]/g,          function(ch) { return '\\x0' + hex(ch); })
              .replace(/[\x10-\x1f\x7f-\x9f]/g, function(ch) { return '\\x' + hex(ch); })
              .replace(/[\xFF-\uFFFF]/g, function(ch) {
                  var hexCode = ch.charCodeAt(0).toString(16).toUpperCase();
                  hexCode = Array(4 - hexCode.length + 1).join('0') + hexCode;
                  return '\\x{' + hexCode + '}';
                })
              + '"';
      }

      if (node.parts.length > 0) {
        regexp = '/^['
          + (node.inverted ? '^' : '')
          + node.parts.map(function(part) {
              return part instanceof Array
                ? quoteForPhpRegexp(part[0])
                  + '-'
                  + quoteForPhpRegexp(part[1])
                : quoteForPhpRegexp(part);
            }).join('')
          + ']/' + (node.ignoreCase ? 'i' : '');
      } else {
        if (!mbstringAllowed) {
          throw new Error(
            'Empty character class matching requires the '
            + '`mbstring` PHP extension, but it is disabled '
            + 'via `mbstringAllowed: false`.'
          );
        }
        /*
         * IE considers regexps /[]/ and /[^]/ as syntactically invalid, so we
         * translate them into euqivalents it can handle.
         */
        regexp = node.inverted ? '/^[\\S\\s]/' : '/^(?!)/';
      }

      if (mbstringAllowed) {
        regexpIndex = addConst(quotePhp(regexp));
      } else {
        var classArray = 'array('
          + node.parts.map(function(part) {
            if (!(part instanceof Array)) {
              part = [part, part];
            }
            return 'array('
              + part[0].charCodeAt(0) + ','
              + part[1].charCodeAt(0) + ')';
          }).join(', ')
          + ')';
        regexpIndex = addConst(classArray);
      }

      var rawText = '[' + node.parts.map(function(part) {
        if ( typeof part === 'string' ) {
          return part;
        }
        return part.join('-');
      }).join('') + ']';

      expectedIndex = addConst([
        'array(',
        '"type" => "class",',
        '"value" => ' + quotePhp(rawText) + ',',
        '"description" => ' + quotePhp(rawText),
        ')'
      ].join(' '));

      return buildCondition(
        [op.MATCH_REGEXP, regexpIndex],
        [op.ACCEPT_N, 1],
        [op.FAIL, expectedIndex]
      );
    },

    any: function() {
      var expectedIndex = addConst('array("type" => "any", "description" => "any character" )');

      return buildCondition(
        [op.MATCH_ANY],
        [op.ACCEPT_N, 1],
        [op.FAIL, expectedIndex]
      );
    }
  });
  
  generate(ast);
};
