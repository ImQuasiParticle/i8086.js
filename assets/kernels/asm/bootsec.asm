org 0x0

begin:
mov cl, 2
mov cx, 2
mov ax, 'ac'
jmp far [cs:bx+0xFF]
mov byte al, [bx]
dupa:
int 3
jmp word 0x7C00:0xFF
jmp far word [cs:bx+0xFFF]
mov ax, word [es:bx+0x5]
jmp dupa
mov ax, -5
stuff: db 0xFF, 0x75, "abcdefghijktlmneoprste"
mov ax, bx
jmp begin
