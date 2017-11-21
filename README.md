# `phpegjs` (PHP PEG.js) [![Build status](https://img.shields.io/travis/nylen/phpegjs/master.svg?style=flat)](https://travis-ci.org/nylen/phpegjs) [![npm package](http://img.shields.io/npm/v/phpegjs.svg?style=flat)](https://www.npmjs.org/package/phpegjs)

A PHP code generation plugin for
[PEG.js](https://github.com/dmajda/pegjs).

Fork of
[`php-pegjs`](https://github.com/Nordth/php-pegjs).

## Requirements

* [PEG.js](http://pegjs.majda.cz/)

Installation
------------

### Node.js

Install PEG.js with `phpegjs` plugin

```sh
$ npm install phpegjs
```

Usage
-----

### Generating a Parser

In Node.js, require both the PEG.js parser generator and the `phpegjs` plugin:

```js
var pegjs = require("pegjs");
var phpegjs = require("phpegjs");
```

To generate a PHP parser, pass both the `phpegjs` plugin and your grammar to
`pegjs.generate`:

```js
var parser = pegjs.generate("start = ('a' / 'b')+", {
    plugins: [phpegjs]
});
```

The method will return source code of generated parser as a string. Unlike
original PEG.js, generated PHP parser will be a class, not a function.

Supported options of `pegjs.generate`:

  * `cache` — if `true`, makes the parser cache results, avoiding exponential
    parsing time in pathological cases but making the parser slower (default:
    `false`). In case of PHP, this is strongly recommended for big grammars
    (like javascript.pegjs or css.pegjs in example folder)
  * `allowedStartRules` — rules the parser will be allowed to start parsing from
    (default: the first rule in the grammar)

You can also pass options specific to the PHP PEG.js plugin as follows:

```js
var parser = pegjs.generate("start = ('a' / 'b')+", {
    plugins: [phpegjs],
    phpegjs: { /* phpegjs-specific options */ }
});
```

Here are the options available to pass this way:

  * `parserNamespace` - namespace of generated parser (default: `PhpPegJs`). If
    value is `''` or `null`, no namespace will be used (and the generated
    parser will be compatible with PHP 5.2).
  * `parserGlobalNamePrefix` - prefix to add to all globally defined names
    including the parser, its helper functions, and the `SyntaxError` class.
    This should only be used if PHP 5.2 compatibility is needed; otherwise the
    `parserNamespace` option should be used instead.
  * `parserClassName` - name of generated class for parser (default: `Parser`).
    Note that if a `parserGlobalNamePrefix` is specified, this prefix will be
    added to the name specified by `parserClassName`.
  * `mbstringAllowed` - whether to allow usage of PHP's `mb_*` functions which
    depend on the `mbstring` extension being installed (default: `true`).  This
    can be disabled for compatibility with a wider range of PHP configurations,
    but this will also disable several features of PEG.js (case-insensitive
    string matching, case-insensitive character classes, and empty character
    classes).  Attempting to use these features with `mbstringAllowed: false`
    will cause `generate` to throw an error.

Using the Parser
----------------

1) Save parser generated by `pegjs.generate` to a file

2) In PHP code:

```php
include "your.parser.file.php";

try {
    $parser = new PhpPegJs\Parser;
    $result = $parser->parse($input);
} catch (PhpPegJs\SyntaxError $ex) {
    // Handle parsing error
    // [...]
}
```

You can use the following snippet to format parsing errors:

```php
catch (PhpPegJs\SyntaxError $ex) {
    $message = "Syntax error: " . $ex->getMessage() . ' at line ' . $ex->grammarLine . ' column ' . $ex->grammarColumn . ' offset ' . $ex->grammarOffset;
}
```

Note that the generated PHP parser will call `preg_match_all( '/./us', ... )`
on the input string.  This may be undesirable for projects that need to
maintain compatibility with PCRE versions that are missing Unicode support
(WordPress, for example).  To avoid this call, split the input string into an
array (one array element per UTF-8 character) and pass this array into
`$parser->parse()` instead of the string input.

Grammar Syntax and Semantics
----------------------------

See documentation of [PEG.js](https://github.com/dmajda/pegjs#grammar-syntax-and-semantics) with one difference: action blocks should be written in PHP.

Original PEG.js rule:

```js
media_list = head:medium tail:("," S* medium)* {
  var result = [head];
  for (var i = 0; i < tail.length; i++) {
    result.push(tail[i][2]);
  }
  return result;
}
```

PHP PEG.js rule:

```php
media_list = head:medium tail:("," S* medium)* {
  $result = array($head);
  for ($i = 0; $i < count($tail); $i++) {
    $result[] = $tail[$i][2];
  }
  return $result;
}
```

To target both JavaScript and PHP with a single grammar, you can mix the two
languages using a special comment syntax:

```js
media_list = head:medium tail:("," S* medium)* {
  /** <?php
  $result = array($head);
  for ($i = 0; $i < count($tail); $i++) {
    $result[] = $tail[$i][2];
  }
  return $result;
  ?> **/

  var result = [head];
  for (var i = 0; i < tail.length; i++) {
    result.push(tail[i][2]);
  }
  return result;
}
```

You can also use the following utility functions in PHP action blocks:

- `chr_unicode($code)` - return character by its UTF-8 code (analogue of
  JavaScript's `String.fromCharCode` function).
- `ord_unicode($code)` - return the UTF-8 code for a character (analogue of
  JavaScript's `String.prototype.charCodeAt(0)` function).

Guide for converting PEG.js action blocks to PHP PEG.js
-------------------------------------------------------

| Javascript code                   | PHP analogue                              |
| --------------------------------- | ----------------------------------------- |
| `some_var`                        | `$some_var`                               |
| `{f1: "val1", f2: "val2"}`        | `array("f1" => "val1", "f2" => "val2")`   |
| `["val1", "val2"]`                | `array("val1", "val2")`                   |
| `some_array.push("val")`          | `$some_array[] = "val"`                   |
| `some_array.length`               | `count($some_array)`                      |
| `some_array.join("")`             | `join("", $some_array)`                   |
| `some_array1.concat(some_array2)` | `array_merge($some_array1, $some_array2)` |
| `parseInt("23")`                  | `intval("23")`                            |
| `parseFloat("23.1")`              | `floatval("23.1")`                        |
| `some_str.length`                 | `mb_strlen(some_str, "UTF-8")`            |
| `some_str.replace("b", "\b")`     | `str_replace("b", "\b", $some_str)`       |
| `String.fromCharCode(2323)`       | `chr_unicode(2323)`                       |

License
-------

[The MIT License (MIT)](http://opensource.org/licenses/MIT)
