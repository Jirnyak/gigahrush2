import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { safeParseJson } from '../src/core/json.js';

describe('safeParseJson', () => {
    test('parses valid JSON successfully', () => {
        const json = '{"name":"John", "age":30}';
        const result = safeParseJson(json);
        assert.deepEqual(result, { name: 'John', age: 30 });
    });

    test('prevents prototype pollution via __proto__', () => {
        const maliciousJson = '{"__proto__": {"polluted": true}, "normal": "value"}';
        const result = safeParseJson(maliciousJson);
        assert.equal(Object.prototype.hasOwnProperty.call(result, '__proto__'), false);
        assert.equal(result.normal, 'value');
        // also assert that object's prototype is not polluted
        assert.equal((result as any).polluted, undefined);
    });

    test('prevents prototype pollution via constructor', () => {
        const maliciousJson = '{"constructor": {"prototype": {"polluted": true}}, "normal": "value"}';
        const result = safeParseJson(maliciousJson);
        assert.equal(Object.prototype.hasOwnProperty.call(result, 'constructor'), false);
        assert.equal(result.normal, 'value');
    });

    test('prevents prototype pollution via prototype', () => {
        const maliciousJson = '{"prototype": {"polluted": true}, "normal": "value"}';
        const result = safeParseJson(maliciousJson);
        assert.equal(Object.prototype.hasOwnProperty.call(result, 'prototype'), false);
        assert.equal(result.normal, 'value');
    });

    test('throws on invalid JSON', () => {
        const invalidJson = '{name: "John"}';
        assert.throws(() => {
            safeParseJson(invalidJson);
        }, SyntaxError);
    });
});
