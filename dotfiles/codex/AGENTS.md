# AGENTS.md

- This computer is shared with a human. Computing resources are finite, so be considerate of the human working on the same computer when executing commands.
- If `request_user_input` tool or `question` tool is available, actively use it when asking multiple questions at once or when presenting multiple options.
- After completing the task, delete any temporary files you created for verification.
- When writing or modifying tests, read the `tdd` skill for test-design guidance. Apply its guidance on behavioral tests, public interfaces, and independent expected values. Follow project-specific testing and mocking policies.
- Write readable code with plenty of line breaks between logical groups, as a human would write. Reduce the token count with an elegant implementation that eliminates unnecessary processing (i.e., reduce the token count with a simple implementation, not by removing line breaks).
- As t_wada mentioned, write "How" in your code, "What" in your test code, "Why" in your commit log, and "Why not" in your code comments. Use comments to explain hacks and why you chose to depart from the conventional approach to achieve a particular goal. Never add comments that are obvious from reading the code.
- Avoid repeating information that can be easily inferred from what you've already explained. In particular, don't follow explanations of failures or limitations with redundant negative statements about their obvious consequences. Also avoid preemptive denials, rebuttals, or caveats addressing claims or questions the user hasn't made. Include negative statements or caveats only when genuinely necessary for accuracy or to prevent significant misunderstandings.
