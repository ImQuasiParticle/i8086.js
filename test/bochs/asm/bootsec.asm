org 0x7c00

mov bx, 0x1
mov es, bx
mov bx, 0x2

lea ax, [es:bx+0x8]
xchg bx, bx

times 510-($-$$) db 0
dw 0xaa55
;db 0xf0, 0xff, 0xff
;times 1024-($-$$) db 0