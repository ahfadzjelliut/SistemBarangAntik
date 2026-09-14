function Button(children,props) {
    return (
        <Button
            {...props}
            className="
            w-full
            bg-orange-400
            hover:bg-orange-500
            active:scale-95
            transition
            text-white
            py-3
            rounded-lg
            font-semibold
            "
        >
            {children}
        </Button>
    );
}
export default Button;
