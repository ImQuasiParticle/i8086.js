use16
org 0x7C00

cs movsb

; ; reset regs
; xor ax, ax
; mov ds, ax
; mov es, ax

; ; init mode
; mov al, 0x13
; mov ah, 0x0
; int 10h

; ; put pixel
; mov ax, 0xA000
; mov es, ax

; mov bx, 0
; mov cx, 320*100

; render_top_row:
;   mov byte [es:bx], 0xF
;   inc bx
;   loop render_top_row

; mov bx, 320*100
; mov cx, 320*100

; render_bottom_row:
;   mov byte [es:bx], 40
;   inc bx
;   loop render_bottom_row

; jmp $

times 510 - ($ - $$) db 0
dw 0xAA55
