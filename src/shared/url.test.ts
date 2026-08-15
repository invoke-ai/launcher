import { describe, expect, it } from 'vitest';

import {
  hasInsecureCredentials,
  isCustomTorchIndexUrlInvalid,
  redactUrlCredentials,
  splitIndexUrlCredentials,
} from './url';

describe('isCustomTorchIndexUrlInvalid', () => {
  it('accepts an empty value (the field is optional)', () => {
    expect(isCustomTorchIndexUrlInvalid('')).toBe(false);
    expect(isCustomTorchIndexUrlInvalid('   ')).toBe(false);
  });

  it('accepts http(s) URLs', () => {
    expect(isCustomTorchIndexUrlInvalid('https://download.pytorch.org/whl/cu126')).toBe(false);
    expect(isCustomTorchIndexUrlInvalid('http://nexus.corp:8081/repository/pypi/simple')).toBe(false);
  });

  it('rejects anything that is not an http(s) URL', () => {
    expect(isCustomTorchIndexUrlInvalid('cu126')).toBe(true);
    expect(isCustomTorchIndexUrlInvalid('htps://download.pytorch.org/whl/cu126')).toBe(true);
    expect(isCustomTorchIndexUrlInvalid('file:///srv/wheels')).toBe(true);
  });
});

describe('redactUrlCredentials', () => {
  it('redacts credentials in a well-formed URL', () => {
    expect(redactUrlCredentials('https://myuser:ghp_TOKEN@nexus.corp/simple')).toBe(
      'https://***:***@nexus.corp/simple'
    );
  });

  it('redacts a username-only userinfo', () => {
    expect(redactUrlCredentials('https://myuser@nexus.corp/simple')).toBe('https://***@nexus.corp/simple');
  });

  it('redacts credentials in a scheme-less value', () => {
    // The WHATWG URL parser reads `myuser:` as the scheme here, so `url.username` is empty and a parser-based
    // implementation returns this untouched - straight into the invalid-URL error path, which logs the value.
    expect(redactUrlCredentials('myuser:ghp_TOKEN@nexus.corp/simple')).toBe('***:***@nexus.corp/simple');
  });

  it('redacts credentials in a value the URL parser rejects', () => {
    expect(redactUrlCredentials('https://myuser:ghp_TOKEN@nexus.corp:999999/simple')).toBe(
      'https://***:***@nexus.corp:999999/simple'
    );
  });

  it('redacts up to the last @ so an unencoded @ in the password does not leak', () => {
    expect(redactUrlCredentials('https://myuser:p@ssw0rd@nexus.corp/simple')).toBe('https://***:***@nexus.corp/simple');
  });

  it('leaves a URL without credentials unchanged', () => {
    expect(redactUrlCredentials('https://download.pytorch.org/whl/cu126')).toBe(
      'https://download.pytorch.org/whl/cu126'
    );
    expect(redactUrlCredentials('https://download.pytorch.org/whl/cu126/torch@2.7.1')).toBe(
      'https://download.pytorch.org/whl/cu126/torch@2.7.1'
    );
  });
});

describe('splitIndexUrlCredentials', () => {
  it('splits credentials out of the URL so they can go in the environment', () => {
    expect(splitIndexUrlCredentials('https://myuser:ghp_TOKEN@nexus.corp/simple')).toEqual({
      url: 'https://nexus.corp/simple',
      username: 'myuser',
      password: 'ghp_TOKEN',
    });
  });

  it('decodes percent-encoded userinfo', () => {
    expect(splitIndexUrlCredentials('https://my%40user:p%40ss@nexus.corp/simple')).toEqual({
      url: 'https://nexus.corp/simple',
      username: 'my@user',
      password: 'p@ss',
    });
  });

  it('returns the URL untouched when there are no credentials', () => {
    expect(splitIndexUrlCredentials('https://download.pytorch.org/whl/cu126')).toEqual({
      url: 'https://download.pytorch.org/whl/cu126',
    });
  });
});

describe('hasInsecureCredentials', () => {
  it('flags credentials sent over plain http', () => {
    expect(hasInsecureCredentials('http://myuser:ghp_TOKEN@nexus.corp/simple')).toBe(true);
  });

  it('does not flag https credentials or credential-free http', () => {
    expect(hasInsecureCredentials('https://myuser:ghp_TOKEN@nexus.corp/simple')).toBe(false);
    expect(hasInsecureCredentials('http://nexus.corp/simple')).toBe(false);
  });
});
