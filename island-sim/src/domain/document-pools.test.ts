import assert from 'node:assert/strict';
import test from 'node:test';
import { readableDocumentPoolWeights, selectReadableDocument } from './document-pools.ts';

test('book and drift-bottle pools independently give every document equal selection probability', () => {
  const books = [
    { id: 'book-a', pool: 'book' as const, text: '' },
    { id: 'book-b', pool: 'book' as const, text: '' },
    { id: 'book-c', pool: 'book' as const, text: '' },
    { id: 'book-d', pool: 'book' as const, text: '' },
    { id: 'book-e', pool: 'book' as const, text: '' },
  ];
  const bottles = [
    { id: 'bottle-a', pool: 'drift-bottle' as const, text: '' },
    { id: 'bottle-b', pool: 'drift-bottle' as const, text: '' },
    { id: 'bottle-c', pool: 'drift-bottle' as const, text: '' },
  ];
  const documents = [...books, ...bottles];
  const bookWeights = readableDocumentPoolWeights(documents, 'book');
  const bottleWeights = readableDocumentPoolWeights(documents, 'drift-bottle');
  assert.deepEqual(bookWeights.map(({ document, probability }) => [document.id, probability]), books.map(({ id }) => [id, 1 / 5]));
  assert.deepEqual(bottleWeights.map(({ document, probability }) => [document.id, probability]), bottles.map(({ id }) => [id, 1 / 3]));
  assert.ok([...bookWeights, ...bottleWeights].every(({ document }) => document.text === ''));
  assert.equal(selectReadableDocument(documents, 'book', 0.21)?.id, 'book-b');
  assert.equal(selectReadableDocument(documents, 'drift-bottle', 0.34)?.id, 'bottle-b');
});

test('adding a document updates the pool probability automatically and empty pools return no selection', () => {
  const books = [
    { id: 'book-a', pool: 'book' as const, text: '' },
    { id: 'book-b', pool: 'book' as const, text: '' },
  ];
  const expanded = [...books, { id: 'book-c', pool: 'book' as const, text: '' }];
  assert.deepEqual(readableDocumentPoolWeights(books, 'book').map(({ probability }) => probability), [0.5, 0.5]);
  assert.deepEqual(readableDocumentPoolWeights(expanded, 'book').map(({ probability }) => probability), [1 / 3, 1 / 3, 1 / 3]);
  assert.equal(selectReadableDocument([], 'drift-bottle', 0.5), null);
  assert.throws(() => selectReadableDocument(expanded, 'book', 1), /\[0, 1\)/);
});
