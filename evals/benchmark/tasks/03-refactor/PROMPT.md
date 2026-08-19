The same actor check — look the user up, refuse an unknown one, refuse one with no
role — is written out three times in this codebase. We are about to add two more
call sites, and nobody wants a fourth copy.

Pull it into one place and use it everywhere it belongs. Behaviour must not change:
the same inputs must still be refused, with the same messages.
