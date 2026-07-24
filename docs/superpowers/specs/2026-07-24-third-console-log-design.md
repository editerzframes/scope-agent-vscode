# Third Console Log Design

## Goal

Add one third message to `hello-world.js`.

## Design

Append this statement after the existing two statements:

```js
console.log("Hello once more!");
```

The script will keep its current direct, sequential structure. Running
`node hello-world.js` will print these exact lines in order:

```text
Hello, world!
Hello again!
Hello once more!
```

## Error Handling

No additional error handling is needed because the change only writes a
constant string to standard output.

## Verification

Run the script with Node and compare its complete standard output with the
three expected lines above.
