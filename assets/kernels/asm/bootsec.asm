org 0x0

jmp 0x0:dupa
mov cl, 2
mov cx, 2
mov ax, 'ac'
jmp far [cs:bx+0xFF]
mov byte al, [bx]
dupa:
  int 3
  jmp word 0x7C00:0xFF
  jmp far word [cs:bx+dupa+0xFFF]
  mov ax, word [es:bx+0x5]
  jmp dupa

stuff: db 0xFF, 0x75, "abcdefghijktlmneoprste"
mov ax, bx
